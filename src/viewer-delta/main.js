import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import createRepacker from '../lib/repacker/repacker.js';

// --- CONFIGURAÇÕES ---
const CONFIG = {
    assets: {
        model: '/lucy/lucy.opt.glb',
        // model: '/lucy/lucy.chunked.opt.glb',
        texture: '/matcap/matcap5.png'
    },
    shaders: {
        vertex: './shaders/vertexShader.glsl',
        fragment: './shaders/fragmentShader.glsl'
    },
    camera: {
        fov: 75,
        near: 0.1,
        far: 10000
    },
    repacker: {
        blockSize: 64 // Deve ser sincronizado com o C++
    },
    colors: {
        background: 0x222222
    }
};

// --- VARIÁVEIS GLOBAIS ---
let scene, camera, renderer, repackerModule;
let modelContainer; // Pivot

// --- FUNÇÕES UTILITÁRIAS ---

function calculateMemoryUsage(object) {
    let totalBytes = 0;

    object.traverse((child) => {
        if (child.isMesh) {
            const geom = child.geometry;
            const attrs = ['a_packed_delta', 'normal', 'index']; // Atributos específicos do Delta

            // 1. Atributos de Geometria
            attrs.forEach(attrName => {
                const attr = geom.attributes[attrName] || geom[attrName]; // .index fica na raiz
                if (attr) {
                    const array = attr.data?.array || attr.array;
                    if (array) totalBytes += array.byteLength;
                }
            });

            // 2. Texturas Especiais (Âncoras) e Uniformes
            if (child.material.uniforms) {
                for (const key in child.material.uniforms) {
                    const val = child.material.uniforms[key].value;
                    // Conta textura de âncoras e matcap
                    if (val && val.isTexture && val.image?.data) {
                        totalBytes += val.image.data.byteLength;
                    }
                }
            }
        }
    });

    return totalBytes;
}

// --- LÓGICA DE REPACK (WASM) ---

/**
 * Processa uma única malha: Envia para Wasm, Compacta, Remapeia Normais e Gera Textura de Âncoras.
 */
function repackGeometry(child, vertexShader, fragmentShader, matcapTexture) {
    const geometry = child.geometry;
    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index;

    // Validação
    if (!indexAttr || !posAttr) return;

    // 1. Preparação de Dados
    const isInterleaved = posAttr.isInterleavedBufferAttribute;
    const sourceArray = isInterleaved ? posAttr.data.array : posAttr.array;
    const inputStride = isInterleaved ? posAttr.data.stride : 3;
    const vertexCount = posAttr.count;

    if (!(sourceArray instanceof Uint16Array)) {
        console.error(`[Repack] Erro: Malha ${child.name} não é Uint16.`);
        return;
    }

    // 2. Alocação Wasm
    const maxVertexCount = Math.floor(vertexCount * 1.5); // Margem para padding
    const maxBlocks = Math.ceil(maxVertexCount / CONFIG.repacker.blockSize) + 1;

    const inputPtr = repackerModule._malloc(sourceArray.byteLength);
    const packedPtr = repackerModule._malloc(maxVertexCount * 4);
    const anchorPtr = repackerModule._malloc(maxBlocks * 3 * 2);
    const remapPtr = repackerModule._malloc(vertexCount * 4);

    // Copia Posições para Wasm
    new Uint16Array(repackerModule.wasmMemory.buffer).set(sourceArray, inputPtr / 2);

    // 3. Executa Repack (C++)
    const realVertexCount = repackerModule._repack_mesh_uint16(
        vertexCount, inputPtr, anchorPtr, packedPtr, remapPtr, inputStride, maxVertexCount
    );

    if (realVertexCount === -1) {
        console.error("[Repack] Estouro de buffer no Wasm.");
        return;
    }

    // 4. Remapeamento de Índices
    const isIndex16 = (indexAttr.array instanceof Uint16Array);
    const indexStride = isIndex16 ? 2 : 4;
    const indicesPtr = repackerModule._malloc(indexAttr.count * indexStride);

    // Copia Índices
    if (isIndex16) {
        new Uint16Array(repackerModule.wasmMemory.buffer).set(indexAttr.array, indicesPtr / 2);
    } else {
        new Uint32Array(repackerModule.wasmMemory.buffer).set(indexAttr.array, indicesPtr / 4);
    }

    // Executa Remap
    repackerModule._apply_remap_generic(indexAttr.count, indicesPtr, remapPtr, indexStride);

    // Resgata Índices
    let newIndices;
    if (isIndex16) {
        newIndices = new Uint16Array(repackerModule.wasmMemory.buffer).slice(indicesPtr / 2, (indicesPtr / 2) + indexAttr.count);
    } else {
        newIndices = new Uint32Array(repackerModule.wasmMemory.buffer).slice(indicesPtr / 4, (indicesPtr / 4) + indexAttr.count);
    }

    // 5. Remapeamento de Normais
    const normalAttr = geometry.attributes.normal;
    const newNormals = new Int8Array(realVertexCount * 3);
    const remapTable = new Uint32Array(repackerModule.wasmMemory.buffer, remapPtr, vertexCount);

    if (normalAttr) {
        for (let i = 0; i < vertexCount; i++) {
            const newIdx = remapTable[i];
            // Converte Float norm (-1.0 a 1.0) para Snorm8 (-127 a 127)
            newNormals[newIdx * 3 + 0] = Math.round(normalAttr.getX(i) * 127);
            newNormals[newIdx * 3 + 1] = Math.round(normalAttr.getY(i) * 127);
            newNormals[newIdx * 3 + 2] = Math.round(normalAttr.getZ(i) * 127);
        }
    }

    // 6. Resgate de Deltas e Âncoras
    const packedDeltas = new Uint32Array(repackerModule.wasmMemory.buffer).slice(packedPtr / 4, (packedPtr / 4) + realVertexCount);
    
    const totalBlocks = Math.ceil(realVertexCount / CONFIG.repacker.blockSize);
    const anchorsRaw = new Uint16Array(repackerModule.wasmMemory.buffer).slice(anchorPtr / 2, (anchorPtr / 2) + (totalBlocks * 3));

    // Limpeza Wasm
    repackerModule._free(inputPtr);
    repackerModule._free(packedPtr);
    repackerModule._free(anchorPtr);
    repackerModule._free(remapPtr);
    repackerModule._free(indicesPtr);

    // 7. Criação da Textura de Âncoras
    const texWidth = 1024;
    const texHeight = Math.ceil((anchorsRaw.length / 3) / texWidth);
    const texData = new Uint16Array(texWidth * texHeight * 4); // RGBA

    for (let i = 0; i < (anchorsRaw.length / 3); i++) {
        texData[i * 4 + 0] = anchorsRaw[i * 3 + 0]; // X -> R
        texData[i * 4 + 1] = anchorsRaw[i * 3 + 1]; // Y -> G
        texData[i * 4 + 2] = anchorsRaw[i * 3 + 2]; // Z -> B
        texData[i * 4 + 3] = 0;                     // A (Padding)
    }

    const anchorTexture = new THREE.DataTexture(
        texData, texWidth, texHeight, 
        THREE.RGBAIntegerFormat, THREE.UnsignedShortType
    );
    anchorTexture.internalFormat = 'RGBA16UI';
    anchorTexture.minFilter = THREE.NearestFilter;
    anchorTexture.magFilter = THREE.NearestFilter;
    anchorTexture.generateMipmaps = false;
    anchorTexture.needsUpdate = true;

    // 8. Montagem Final da Geometria
    // Atributo Delta (Uint32)
    const deltaAttr = new THREE.BufferAttribute(packedDeltas, 1);
    deltaAttr.gpuType = THREE.UnsignedIntType;
    child.geometry.setAttribute('a_packed_delta', deltaAttr);

    // Atributo Normal (Int16 Normalizado)
    child.geometry.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3, true));

    // Índice
    child.geometry.setIndex(new THREE.BufferAttribute(newIndices, 1));

    // Remove atributos antigos
    child.geometry.deleteAttribute('position');
    if (child.geometry.attributes.uv) child.geometry.deleteAttribute('uv');
    if (child.geometry.attributes.color) child.geometry.deleteAttribute('color');

    // Material Shader
    child.material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: {
            u_anchors: { value: anchorTexture },
            u_textureSize: { value: new THREE.Vector2(texWidth, texHeight) },
            u_matcap: { value: matcapTexture },
            u_blockSize: { value: CONFIG.repacker.blockSize }
        },
        side: THREE.DoubleSide
    });

    child.frustumCulled = false; // Necessário pois o Box não é atualizado na CPU
}

// --- INICIALIZAÇÃO ---

async function init() {
    // 1. Inicializa Wasm
    repackerModule = await createRepacker();
    repackerModule._set_block_size(CONFIG.repacker.blockSize);
    console.log("[Sistema] Wasm carregado.");

    // 2. Setup Three.js
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.background);

    camera = new THREE.PerspectiveCamera(
        CONFIG.camera.fov, 
        window.innerWidth / window.innerHeight, 
        CONFIG.camera.near, 
        CONFIG.camera.far
    );

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize, false);

    // 3. Carrega Recursos
    const textureLoader = new THREE.TextureLoader();
    const [vertexShader, fragmentShader, matcapTexture] = await Promise.all([
        fetch(CONFIG.shaders.vertex).then(res => res.text()),
        fetch(CONFIG.shaders.fragment).then(res => res.text()),
        textureLoader.loadAsync(CONFIG.assets.texture)
    ]);

    // 4. Carrega Modelo
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    try {
        const gltf = await loader.loadAsync(CONFIG.assets.model);
        const model = gltf.scene;

        console.time("Total Repack Time");
        
        // Processa cada malha
        model.traverse((child) => {
            if (child.isMesh) {
                repackGeometry(child, vertexShader, fragmentShader, matcapTexture);
            }
        });
        
        console.timeEnd("Total Repack Time");

        // Log de Memória
        const bytes = calculateMemoryUsage(model);
        console.log(`[Memory] Estimativa VRAM: ${(bytes / 1024 / 1024).toFixed(2)} MB`);

        // Setup de Cena
        modelContainer = new THREE.Object3D();
        modelContainer.add(model);
        scene.add(modelContainer);

        setupPositioning(model);

    } catch (error) {
        console.error("Erro fatal:", error);
    }

    renderer.setAnimationLoop(animate);
}

function setupPositioning(mesh) {
    // Mesma lógica do Standard para garantir comparação visual justa
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3()).length();

    modelContainer.rotation.y = Math.PI;
    mesh.position.set(-730, -200, -150);

    camera.position.set(0, size * 0.2, size * 0.8);
    camera.lookAt(0, 0, 0);
    camera.far = size * 5;
    camera.updateProjectionMatrix();

    console.log('[Scene] Posicionamento aplicado.');
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.render(scene, camera);
    // if (modelContainer) modelContainer.rotation.y += 0.05;
}

init();
