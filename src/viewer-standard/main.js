import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';


// --- ARQUIVOS DE ENTRADA ---
// 1. O modelo
const scenePath = '/lucy/lucy.opt.glb';
// const scenePath = '/lucy/lucy.glb';
// const scenePath = '/lucy/lucy.chunked.glb';
// const scenePath = '/lucy/lucy.chunked.opt.glb';


// 2. Os shaders
const vertexShaderPath = './shaders/vertexShader.glsl';
const fragmentShaderPath = './shaders/fragmentShader.glsl';
const matcapTexturePath = '/matcap/matcap5.png'; 



async function setupAndRun() {

    let model; 
    let pivot;

    function createAxisLine(start, end, color = 0xff0000) {
        const material = new THREE.LineBasicMaterial({ color });
        const points = [ start, end ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, material);
    }

    function createAxes(size = 1) {
        const axes = new THREE.Group();

        // X (vermelho)
        axes.add(createAxisLine(
            new THREE.Vector3(-size, 0, 0),
            new THREE.Vector3(size, 0, 0),
            0xff0000
        ));

        // Y (verde)
        axes.add(createAxisLine(
            new THREE.Vector3(0, -size, 0),
            new THREE.Vector3(0, size, 0),
            0x00ff00
        ));

        // Z (azul)
        axes.add(createAxisLine(
            new THREE.Vector3(0, 0, -size),
            new THREE.Vector3(0, 0, size),
            0x0000ff
        ));

        return axes;
    }


    // --- CARREGAMENTO ASSÍNCRONO ---
    // Carrega os shaders e a textura de uma só vez
    const textureLoader = new THREE.TextureLoader();
    const [vertexShader, fragmentShader, matcapTexture] = await Promise.all([
        fetch(vertexShaderPath).then(res => res.text()),
        fetch(fragmentShaderPath).then(res => res.text()),
        textureLoader.loadAsync(matcapTexturePath)
    ]);

    // --- CONFIGURAÇÃO BÁSICA ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222); // Fundo escuro
    const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize( window.innerWidth, window.innerHeight );
    document.body.appendChild( renderer.domElement );

    // --- MATERIAL CUSTOMIZADO ---
    // Define os uniforms que passaremos aos shaders
    const customUniforms = {
        u_matcap: { value: matcapTexture }
    };

    // Cria o ShaderMaterial (APENAS UMA VEZ)
    const customMaterial = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: customUniforms,
        side: THREE.DoubleSide // Para garantir que veremos o interior (se houver)
    });

    // --- CARREGAMENTO DO MODELO ---
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load(
        scenePath,
        (gltf) => {
            model = gltf.scene; 

            let tamanho = 0;


            // Percorre o modelo para aplicar o material e centrar a geometria
            model.traverse((child) => {
                if (child.isMesh) {
                    // Aplica nosso material customizado
                    child.material = customMaterial;
                    const posAttr = child.geometry.attributes.position
                    // console.log('Geometria:', posAttr);
                    
                    
                    console.log(child.geometry);
                    
                    
                    // console.log(child.geometry.attributes.position.data);
                    // console.log(child.geometry.attributes.position.data.count);

                    if (child.geometry.attributes.normal?.data) {
                        tamanho += child.geometry.attributes.normal.data.array.byteLength;
                        console.log("Normal size:", child.geometry.attributes.normal.data.array.byteLength);
                        console.log("Normal count:", child.geometry.attributes.normal.data.count);
                    }
                    else if (child.geometry.attributes.normal) {
                        tamanho += child.geometry.attributes.normal.array.byteLength;
                        console.log("Normal size:", child.geometry.attributes.normal.array.byteLength);
                        console.log("Normal count:", child.geometry.attributes.normal.count);
                    }
                    else{
                        console.log('Geometria não possui normal!');
                    }

                    if (child.geometry.attributes.position?.data) {
                        tamanho += child.geometry.attributes.position.data.array.byteLength;
                        console.log("Position size:", child.geometry.attributes.position.data.array.byteLength);
                        console.log("Position count:", child.geometry.attributes.position.data.count);
                    }
                    else if (child.geometry.attributes.position) {
                        tamanho += child.geometry.attributes.position.array.byteLength;
                        console.log("Position size:", child.geometry.attributes.position.array.byteLength);
                        console.log("Position count:", child.geometry.attributes.position.count);
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
        },
        (xhr) => {
            console.log((xhr.loaded / xhr.total * 100) + '% carregado');
        },
        (error) => {
            console.error('Erro ao carregar o modelo:', error);
        }
    );

    

    // --- LOOP DE ANIMAÇÃO ---
    function animate() {
        renderer.render( scene, camera );
        
        if (pivot && model) {
            // pivot.rotation.y += 0.1;
        }
    }
    renderer.setAnimationLoop( animate );
}

// Inicia a aplicação
setupAndRun();