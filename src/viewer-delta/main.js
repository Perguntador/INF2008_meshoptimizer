import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';

import createRepacker from '../lib/repacker/repacker.js';

let repackerModule;

// Sincronizado com o C++ (Divisível por 32 e por 3)
const BLOCK_SIZE = 64; 

// 1. Inicializa o Wasm antes de qualquer coisa
createRepacker().then(module => {
    repackerModule = module;
    repackerModule._set_block_size(BLOCK_SIZE);
    console.log("WASM carregado com sucesso.");
    setupAndRun(); 
});

// --- CONFIGURAÇÕES ---
const scenePath = '/lucy/lucy.opt.glb';
// const scenePath = '/lucy/lucy.chunked.opt.glb';


const vertexShaderPath = './shaders/vertexShader.glsl';
const fragmentShaderPath = './shaders/fragmentShader.glsl';
const matcapTexturePath = '/matcap/matcap5.png'; 


async function setupAndRun() {
    // Garante que o módulo existe
    if (!repackerModule) {
        console.error("Erro fatal: Módulo Wasm não foi carregado.");
        return;
    }

    let pivot;

    // --- CARREGAMENTO DE ASSETS ---
    const textureLoader = new THREE.TextureLoader();
    
    // Carrega tudo em paralelo para agilizar
    const [vertexShader, fragmentShader, matcapTexture] = await Promise.all([
        fetch(vertexShaderPath).then(res => res.text()),
        fetch(fragmentShaderPath).then(res => res.text()),
        textureLoader.loadAsync(matcapTexturePath)
    ]);

    // --- SETUP DA CENA ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222); 

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // renderer.setPixelRatio(window.devicePixelRatio); // Opcional: melhora nitidez em telas retina
    document.body.appendChild(renderer.domElement);

    // --- CARREGAMENTO DO MODELO ---
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder); // Decodificador oficial para ler o GLB compactado

    loader.load(
        scenePath,
        (gltf) => {
            const model = gltf.scene; 

            let tamanho = 0;


            // Percorre a hierarquia do modelo
            model.traverse((child) => {
                if (child.isMesh) {

                    // --- ETAPA 1: LEITURA E ANÁLISE DOS DADOS ---

                    const geometry = child.geometry;
                    
                    // Garante que o BoundingBox existe (útil para debug ou culling futuro)
                    geometry.computeBoundingBox();

                    const posAttr = geometry.attributes.position;
                    const indexAttr = geometry.index;

                    // Validação: Nossa estratégia de remapeamento EXIGE índices.
                    if (!indexAttr) {
                        console.warn(`Malha '${child.name}' ignorada: Sem índices.`);
                        return;
                    }

                    // --- DETECÇÃO DE FORMATO (Interleaved vs Planar) ---
                    const isInterleaved = posAttr.isInterleavedBufferAttribute;
                    
                    // Se for intercalado, pegamos o array RAIZ (.data.array) e o stride do buffer.
                    // Se for normal, pegamos o array do atributo e stride é 3 (x,y,z).
                    const sourceArray = isInterleaved ? posAttr.data.array : posAttr.array;
                    const inputStride = isInterleaved ? posAttr.data.stride : 3;

                    const vertexCount = posAttr.count;
                    const indexCount = indexAttr.count;

                    // Log para conferência (Verifique isso no console!)
                    console.group(`Processando Malha: ${child.name || 'Sem Nome'}`);
                    console.log(`Tipo do Array: ${sourceArray.constructor.name}`); // Deve ser Uint16Array
                    console.log(`Vértices Lógicos: ${vertexCount}`);
                    console.log(`Tamanho do Buffer Real: ${sourceArray.length}`);
                    console.log(`Stride (Passo): ${inputStride}`);
                    console.groupEnd();

                    // Se o array não for Uint16Array, pare aqui, pois o C++ espera short*
                    if (!(sourceArray instanceof Uint16Array)) {
                         console.error("ERRO CRÍTICO: O C++ espera Uint16Array. O modelo carregado não está quantizado corretamente?");
                         return;
                    }


                    // --- ETAPA 2: ALOCAÇÃO E CÓPIA DE MEMÓRIA ---

                    // Calculamos o pior caso para o tamanho da saída (incluindo padding)
                    const maxVertexCount = Math.floor(vertexCount * 1.5); 

                    // 1. Alocações (Malloc)
                    // inputPtr: Tamanho exato do array de entrada em bytes
                    const inputPtr = repackerModule._malloc(sourceArray.byteLength);
                    
                    // packedPtr: Saída dos deltas compactados (Uint32 = 4 bytes)
                    const packedPtr = repackerModule._malloc(maxVertexCount * 4);
                    
                    // anchorPtr: Saída das âncoras (3 components * 2 bytes (Uint16))
                    // Estimamos o número máximo de blocos necessários
                    const maxBlocks = Math.ceil(maxVertexCount / BLOCK_SIZE) + 1;
                    const anchorPtr = repackerModule._malloc(maxBlocks * 3 * 2);

                    // remapPtr: Tabela de tradução (Indice Velho -> Indice Novo). Uint32.
                    const remapPtr = repackerModule._malloc(vertexCount * 4);

                    // 2. Transferência (JS -> Wasm)
                    // Criamos uma view Uint16 na memória do Wasm para copiar os dados
                    // Dividimos o ponteiro por 2 (>> 1) porque o array é de 16 bits (2 bytes)
                    const heapU16 = new Uint16Array(repackerModule.wasmMemory.buffer);
                    
                    // Copiamos o array bruto do GLTFLoader direto para o Wasm.
                    // Isso inclui o 'lixo' intercalado, mas o Stride cuidará disso no C++.
                    heapU16.set(sourceArray, inputPtr / 2);

                    // --- ETAPA 3: EXECUÇÃO DA FUNÇÃO C++ ---
                    
                    console.log("Iniciando Repack no C++...");
                    const startTime = performance.now();

                    // Chamada da função:
                    // Note que passamos 'inputStride' (4), permitindo que o C++ pule
                    // os dados extras do buffer interleaved corretamente.
                    const realVertexCount = repackerModule._repack_mesh_uint16(
                        vertexCount,    // Contagem lógica de vértices
                        inputPtr,       // Ponteiro dos dados brutos
                        anchorPtr,      // Ponteiro de saída (Âncoras)
                        packedPtr,      // Ponteiro de saída (Deltas)
                        remapPtr,       // Ponteiro de saída (Tabela Remap)
                        inputStride,    // O Passo (4)
                        maxVertexCount  // Limite de segurança
                    );

                    const endTime = performance.now();
                    console.log(`Repack concluído em ${(endTime - startTime).toFixed(2)}ms`);

                    // Verificação de Erro (Overflow)
                    if (realVertexCount === -1) {
                        console.error("ERRO CRÍTICO: O buffer Wasm estourou (Overflow). Aumente o multiplicador de maxVertexCount.");
                        
                        // Limpeza de emergência
                        repackerModule._free(inputPtr);
                        repackerModule._free(packedPtr);
                        repackerModule._free(anchorPtr);
                        repackerModule._free(remapPtr);
                        return;
                    }

                    console.log(`Vértices Finais (com padding): ${realVertexCount}`);
                    console.log(`Expansão: ${((realVertexCount / vertexCount) * 100).toFixed(1)}% do original`);

                    // --- ETAPA 4: REMAPEAMENTO DE ÍNDICES (Dinâmico) ---

                    // --- DINÂMICA DE ÍNDICES ---
                    // Detecta se é Uint16 ou Uint32
                    const isIndex16 = (indexAttr.array instanceof Uint16Array);
                    const indexStride = isIndex16 ? 2 : 4; // Bytes por índice
                    const indexByteLength = indexAttr.count * indexStride;

                    console.log(`Índices: ${indexAttr.count} (${isIndex16 ? '16-bit' : '32-bit'})`);
                    

                    console.log("Atualizando índices...");

                    // 1. Alocação Genérica (Baseada no tamanho em bytes)
                    const indicesPtr = repackerModule._malloc(indexByteLength);
                    
                    // 2. Cópia (JS -> Wasm)
                    // Usamos a view correta baseada no tipo
                    if (isIndex16) {
                        const heapU16_Index = new Uint16Array(repackerModule.wasmMemory.buffer);
                        // Copia direto (Uint16 -> Uint16)
                        heapU16_Index.set(indexAttr.array, indicesPtr / 2);
                    } else {
                        const heapU32_Index = new Uint32Array(repackerModule.wasmMemory.buffer);
                        heapU32_Index.set(indexAttr.array, indicesPtr / 4);
                    }

                    // 3. Execução Genérica
                    repackerModule._apply_remap_generic(
                        indexAttr.count, 
                        indicesPtr, 
                        remapPtr,
                        indexStride // Passamos 2 ou 4
                    );

                    // 4. Resgate (Wasm -> JS)
                    let newIndices;
                    
                    // Atualiza views (sempre!)
                    if (isIndex16) {
                        const finalHeapU16 = new Uint16Array(repackerModule.wasmMemory.buffer);
                        newIndices = finalHeapU16.slice(indicesPtr / 2, (indicesPtr / 2) + indexAttr.count);
                    } else {
                        const finalHeapU32 = new Uint32Array(repackerModule.wasmMemory.buffer);
                        newIndices = finalHeapU32.slice(indicesPtr / 4, (indicesPtr / 4) + indexAttr.count);
                    }

                    repackerModule._free(indicesPtr);
                    repackerModule._free(remapPtr);




                    // --- ETAPA 4.5: REMAPEAMENTO DE NORMAIS ---
                    // (Inserir antes de dar _free no remapPtr)

                    console.log("Remapeando normais...");

                    const normalAttr = geometry.attributes.normal;
                    // Cria buffer para as novas normais (Tamanho real com padding * 3 eixos)
                    const newNormals = new Int16Array(realVertexCount * 3);
                    
                    // Acessa a tabela de remapeamento que ainda está no Wasm
                    const remapTable = new Uint32Array(repackerModule.wasmMemory.buffer, remapPtr, vertexCount);

                    if (normalAttr) {
                        for(let i = 0; i < vertexCount; i++) {
                            const newIndex = remapTable[i];
        
                            // Lemos a normal original (Three.js normaliza float para nós)
                            const nx = normalAttr.getX(i);
                            const ny = normalAttr.getY(i);
                            const nz = normalAttr.getZ(i);

                            // Convertemos Float (-1.0 a 1.0) para Int16 (-32767 a 32767)
                            newNormals[newIndex * 3 + 0] = nx * 32767;
                            newNormals[newIndex * 3 + 1] = ny * 32767;
                            newNormals[newIndex * 3 + 2] = nz * 32767;
                        }
                    }
                    else {
                        console.warn("Atributo de normais não encontrado; pulando remapeamento de normais.");
                    }


                    // Libera a memória dos índices e do mapa (não precisamos mais deles)
                    repackerModule._free(indicesPtr);
                    repackerModule._free(remapPtr); // Já usamos para corrigir, pode limpar.

                    console.log("Índices atualizados e recuperados.");



                    // --- ETAPA 5: RESGATE FINAL E LIMPEZA ---

                    // Atualizamos as views da memória (boa prática sempre que formos ler)
                    const finalHeapU32 = new Uint32Array(repackerModule.wasmMemory.buffer);
                    const finalHeapU16 = new Uint16Array(repackerModule.wasmMemory.buffer);

                    // 1. Resgate dos Deltas Compactados
                    // slice() faz uma cópia profunda para o JS
                    const packedDeltas = finalHeapU32.slice(packedPtr / 4, (packedPtr / 4) + realVertexCount);

                    // 2. Resgate das Âncoras
                    // Calculamos quantas âncoras reais foram usadas baseadas no número de vértices finais
                    // Cada âncora cobre um bloco de 96 vértices.
                    const totalBlocks = Math.ceil(realVertexCount / BLOCK_SIZE);
                    const totalAnchorValues = totalBlocks * 3; // X, Y, Z por bloco
                    
                    const anchors = finalHeapU16.slice(anchorPtr / 2, (anchorPtr / 2) + totalAnchorValues);

                    // 3. Limpeza de Memória (Free)
                    // Já temos tudo copiado no JS, podemos devolver a memória pro Wasm
                    repackerModule._free(inputPtr);
                    repackerModule._free(packedPtr);
                    repackerModule._free(anchorPtr);
                    // (remapPtr e indicesPtr já foram liberados na etapa anterior)

                    console.log(`Deltas recuperados: ${packedDeltas.length}`);
                    console.log(`Âncoras recuperadas: ${anchors.length / 3} (para ${totalBlocks} blocos)`);



                    // --- ETAPA 6: CRIAÇÃO DA TEXTURA DE ÂNCORAS ---

                    // Definimos uma largura fixa para a textura
                    const texWidth = 1024;
                    const texHeight = Math.ceil((anchors.length / 3) / texWidth);
                    
                    // Alocamos memória para a textura: Largura * Altura * 4 canais (RGBA)
                    // Precisamos de 4 canais para alinhamento, mesmo usando apenas XYZ.
                    const texData = new Uint16Array(texWidth * texHeight * 4);

                    const totalAnchors = anchors.length / 3;

                    for (let i = 0; i < totalAnchors; i++) {
                        // Copia X, Y, Z do array linear para R, G, B da textura
                        texData[i * 4 + 0] = anchors[i * 3 + 0]; // X
                        texData[i * 4 + 1] = anchors[i * 3 + 1]; // Y
                        texData[i * 4 + 2] = anchors[i * 3 + 2]; // Z
                        texData[i * 4 + 3] = 0; // A (Padding/Lixo)
                    }

                    // Cria a textura no Three.js
                    const anchorTexture = new THREE.DataTexture(
                        texData, 
                        texWidth, 
                        texHeight, 
                        THREE.RGBAIntegerFormat, // Formato para ler inteiros puros (não normalizados)
                        THREE.UnsignedShortType
                    );

                    // Configurações OBRIGATÓRIAS para sampler2D de inteiros no WebGL 2
                    anchorTexture.internalFormat = 'RGBA16UI'; 
                    anchorTexture.minFilter = THREE.NearestFilter; // Sem interpolação (vizinho mais próximo)
                    anchorTexture.magFilter = THREE.NearestFilter;
                    anchorTexture.generateMipmaps = false;
                    anchorTexture.unpackAlignment = 1;
                    anchorTexture.needsUpdate = true;

                    console.log(`Textura de Âncoras criada: ${texWidth}x${texHeight}`);




                    // --- ETAPA 7: MONTAGEM DA GEOMETRIA ---

                    console.log("Atualizando atributos da geometria...");

                    // 1. Inserir o Delta Compactado
                    const deltaAttr = new THREE.BufferAttribute(packedDeltas, 1);
                    deltaAttr.gpuType = THREE.UnsignedIntType; // OBRIGATÓRIO para 'in uint'
                    child.geometry.setAttribute('a_packed_delta', deltaAttr);

                    // 2. Atualizar Índices (Topologia)
                    child.geometry.setIndex(new THREE.BufferAttribute(newIndices, 1));

                    // 3. Remover Posição Antiga (Não serve mais)
                    child.geometry.deleteAttribute('position');

                    // 4. Ajuste Provisório de Normais (CORRIGIDO)
                    // Criamos um buffer vazio do tamanho exato que precisamos.
                    // Não copiamos o antigo agora para evitar o erro de RangeError e mistura de dados.
                    const newNormalArr = new Float32Array(realVertexCount * 3);
                    
                    // Preenche com uma normal "para cima" (0, 1, 0) apenas para não ficar tudo (0,0,0)
                    // Isso ajuda a ter algum sombreamento básico no Matcap.
                    for(let i=0; i < realVertexCount; i++) {
                        newNormalArr[i*3 + 1] = 1.0; 
                    }

                    // 4. Inserção das Normais Corretas (DEFINITIVO)
                    const normalAttribute = new THREE.BufferAttribute(newNormals, 3, true);
                    child.geometry.setAttribute('normal', normalAttribute);
                    // child.geometry.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));


                    // 5. Configuração do Material
                    child.material = new THREE.ShaderMaterial({
                        glslVersion: THREE.GLSL3, // Ativa WebGL 2 (versão 300 es)
                        vertexShader: vertexShader,
                        fragmentShader: fragmentShader,
                        uniforms: {
                            u_anchors: { value: anchorTexture },
                            u_textureSize: { value: new THREE.Vector2(texWidth, texHeight) },
                            u_matcap: { value: matcapTexture },
                            u_blockSize: { value: BLOCK_SIZE }
                        },
                        side: THREE.DoubleSide
                    });

                    // 6. Escala Final
                    // Como não normalizamos no JS, os dados são Inteiros Gigantes (ex: 14000).
                    // O GLTFLoader geralmente já coloca a escala correta no 'child.scale' ou 'model.scale'.
                    // Vamos forçar o FrustumCulling off para garantir que apareça mesmo se o Box estiver errado.
                    child.frustumCulled = false; 



                    if (child.geometry.attributes.uv) {
                        child.geometry.deleteAttribute('uv'); 
                        console.log("Atributo UV removido.");
                        // Se você precisar de UVs, terá que remapeá-los igual fez com as normais!
                    }
                    if (child.geometry.attributes.color) {
                        child.geometry.deleteAttribute('color');
                        console.log("Atributo Color removido.");
                    }

                    // console.log("Geometria montada e enviada para a GPU.");
                    // console.log(child.geometry)


                    if (child.geometry.attributes.normal) {
                        tamanho += child.geometry.attributes.normal.array.byteLength;
                        console.log("Normal size:", child.geometry.attributes.normal.array.byteLength);
                        console.log("Normal count:", child.geometry.attributes.normal.count);

                    }
                    else{
                        console.log('Geometria não possui normal!');
                    }

                    if (child.geometry.attributes.a_packed_delta) {
                        tamanho += child.geometry.attributes.a_packed_delta.array.byteLength;
                        console.log("Delta size:", child.geometry.attributes.a_packed_delta.array.byteLength);
                        console.log("Delta count:", child.geometry.attributes.a_packed_delta.count);
                    }
                    else{
                        console.log('Geometria não possui posição!');
                    }

                    if (child.geometry.index) {
                        tamanho += child.geometry.index.array.byteLength;
                        console.log("Index size:", child.geometry.index.array.byteLength);
                        console.log("Index count:", child.geometry.index.count);
                    } else {
                        console.log('Geometria não possui índice!');
                    }



                    // Medindo a Textura de Âncoras (se existir no material)
                    if (child.material.uniforms && child.material.uniforms.u_anchors) {
                        const texture = child.material.uniforms.u_anchors.value;
                        const image = texture.image;
                        
                        if (image && image.data) {
                            // data.byteLength dá o tamanho exato do ArrayBuffer da textura
                            const texSize = image.data.byteLength;
                            tamanho += texSize;
                            console.log("Texture (Anchors) size:", texSize);
                            
                            // Verificação de Mipmaps (O vilão oculto)
                            if (texture.generateMipmaps) {
                                console.warn("ATENÇÃO: Mipmaps ativados! O tamanho na VRAM será ~33% maior.");
                                tamanho += Math.floor(texSize * 0.33);
                            }
                        }
                    }
                    
                    
                    
                }
            });
            console.log("Tamanho TOTAL estimado (Bytes):", tamanho);
            console.log("Tamanho TOTAL estimado (MB):", (tamanho / 1024 / 1024).toFixed(2));


            pivot = new THREE.Object3D();
            scene.add(pivot);

            // Insere o modelo dentro do pivô
            pivot.add(model);

            // Calcula a caixa "bruta" do modelo como ele veio
            const box = new THREE.Box3().setFromObject(model);
            const boxCenter = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3()).length();

            // Centraliza o MODELO (o contêiner), movendo-o na direção oposta ao centro
            // model.position.sub(boxCenter);

            // --- ENQUADRAMENTO E TILT ---
            // Posiciona a câmera com base no tamanho calculado corretamente
            // camera.position.set(0*size * 0.5, size * 0.4, size * 0.8); 
            camera.position.set(0*size * 0.5, size * 0.2, size * 0.8); 
            // camera.position.set(size * 0.0, -size * 0.6, size * 0.0); 
            camera.lookAt(0, 0, 0); 
            camera.far = size * 5;
            camera.updateProjectionMatrix(); 
            
            // Aplica as rotações desejadas
            // model.rotation.x = -Math.PI/2;
            pivot.rotation.y = Math.PI;

            model.position.x = -730;
            model.position.z = -150;
            model.position.y = -200;
                    
            // const axes = createAxes(size); // tamanho
            // scene.add(axes);

            console.log('Modelo carregado e centralizado corretamente!');
            // console.log("Tamanho TOTAL estimado (Bytes):", tamanho);
            // console.log("Tamanho TOTAL estimado (MB):", (tamanho / 1024 / 1024).toFixed(2));

            // // --- AJUSTES FINAIS DE CENA ---
            // // Centraliza o objeto e ajusta a câmera automaticamente
            // const box = new THREE.Box3().setFromObject(model);
            // const center = box.getCenter(new THREE.Vector3());
            // const size = box.getSize(new THREE.Vector3()).length();

            // // model.position.sub(center); // Centraliza o modelo no (0,0,0)

            // // Cria um Pivot para rotação (opcional, mas bom para visualização)
            // pivot = new THREE.Object3D();
            // scene.add(pivot);
            // pivot.add(model);

            // // Posiciona câmera baseada no tamanho do objeto
            // camera.position.set(0*size * 0.5, size * 0.2, size * 0.0); 

            // camera.lookAt(0, 0, 0);
            
            // camera.far = size * 5;
            // camera.updateProjectionMatrix(); 

            
            // pivot.rotation.y = Math.PI;

            // model.position.x = -730;
            // model.position.z = -150;
            // model.position.y = -200;

            // console.log('Cena pronta.');

        },
        (xhr) => {
            // Progresso (opcional)
            console.log((xhr.loaded / xhr.total * 100) + '% carregado');
        },
        (error) => {
            console.error('Erro ao carregar GLB:', error);
        }
    );

    // Inicia o loop de animação apenas após carregar tudo
    renderer.setAnimationLoop(() => {
        if (pivot){

            // pivot.rotation.y += 0.1;
            renderer.render(scene, camera);
        }
    });

    // Handler de resize da janela
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

