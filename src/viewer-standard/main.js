import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';

// --- CONFIGURAÇÕES ---
const CONFIG = {
    assets: {
        model: '/lucy/lucy.glb',
        // model: '/lucy/lucy.opt.glb',
        // model: '/lucy/lucy.chunked.glb',
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
        far: 1000
    },
    colors: {
        background: 0x222222
    }
};

// --- VARIÁVEIS GLOBAIS ---
let scene, camera, renderer;
let modelContainer, modelMesh; // Container (Pivot) e a Malha

// --- FUNÇÕES UTILITÁRIAS ---

/**
 * Calcula estimativa de uso de VRAM da geometria e texturas.
 * Suporta atributos padrão do Three.js e estruturas comprimidas do GLTFLoader/Meshopt.
 */
function calculateMemoryUsage(object) {
    let totalBytes = 0;

    object.traverse((child) => {
        if (child.isMesh) {
            const geom = child.geometry;
            const attrs = ['position', 'normal', 'uv', 'color'];

            // 1. Calcula tamanho dos atributos de geometria
            attrs.forEach(attrName => {
                const attr = geom.attributes[attrName];
                if (attr) {
                    // Verifica se os dados estão diretos (.array) ou aninhados (.data.array para alguns loaders)
                    const array = attr.data?.array || attr.array;
                    if (array) {
                        totalBytes += array.byteLength;
                    }
                }
            });

            // 2. Calcula tamanho do índice
            if (geom.index) {
                const array = geom.index.data?.array || geom.index.array;
                if (array) {
                    totalBytes += array.byteLength;
                }
            }

            // 3. Calcula texturas customizadas (Ex: Âncoras/Dados em textura)
            // Nota: Texturas padrão (map, normalMap) geralmente são compartilhadas e devem ser contadas separadamente.
            if (child.material.uniforms) {
                for (const key in child.material.uniforms) {
                    const value = child.material.uniforms[key].value;
                    if (value && value.isTexture && value.image && value.image.data) {
                        const texSize = value.image.data.byteLength;
                        totalBytes += texSize;
                        
                        if (value.generateMipmaps) {
                            totalBytes += Math.floor(texSize * 0.33);
                        }
                    }
                }
            }
        }
    });

    return totalBytes;
}

// --- INICIALIZAÇÃO ---

async function init() {
    // 1. Setup Básico (Scene, Camera, Renderer)
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

    // 2. Listener de Redimensionamento
    window.addEventListener('resize', onWindowResize, false);

    // 3. Carregamento de Recursos (Shaders e Textura)
    const textureLoader = new THREE.TextureLoader();
    const [vertexShader, fragmentShader, matcapTexture] = await Promise.all([
        fetch(CONFIG.shaders.vertex).then(res => res.text()),
        fetch(CONFIG.shaders.fragment).then(res => res.text()),
        textureLoader.loadAsync(CONFIG.assets.texture)
    ]);

    // 4. Criação do Material Global
    const customMaterial = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        uniforms: {
            u_matcap: { value: matcapTexture }
        },
        side: THREE.DoubleSide
    });

    // 5. Carregamento do Modelo
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    try {
        const gltf = await loader.loadAsync(CONFIG.assets.model);
        modelMesh = gltf.scene;

        // Processamento da Malha
        modelMesh.traverse((child) => {
            if (child.isMesh) {
                child.material = customMaterial;
            }
        });

        // Logs de Memória
        const bytes = calculateMemoryUsage(modelMesh);
        console.log(`[Memory] Tamanho estimado da Geometria: ${(bytes / 1024 / 1024).toFixed(2)} MB`);

        // Setup de Posicionamento (Pivot)
        modelContainer = new THREE.Object3D();
        modelContainer.add(modelMesh);
        scene.add(modelContainer);

        setupPositioning(modelMesh);

    } catch (error) {
        console.error('Erro fatal ao carregar o modelo:', error);
    }

    // 6. Inicia Loop
    renderer.setAnimationLoop(animate);
}

function setupPositioning(mesh) {
    // Calcula Bounding Box para referência de tamanho e câmera
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3()).length();

    // Configuração Manual de Posição e Rotação
    // Nota: Valores mantidos conforme especificação original para alinhamento visual
    modelContainer.rotation.y = Math.PI;
    
    mesh.position.set(-730, -200, -150);

    // Configuração Automática da Câmera baseada no tamanho do objeto
    camera.position.set(0, size * 0.2, size * 0.8);
    camera.lookAt(0, 0, 0);
    camera.far = size * 5;
    camera.updateProjectionMatrix();

    console.log('Cena configurada.');
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

let lastTime = performance.now();
let frameCount = 0;

function animate() {
    renderer.render(scene, camera);

    // Rotação opcional
    if (modelContainer) modelContainer.rotation.y += 0.05;

    // FPS
    frameCount++;
    const now = performance.now();

    if (now - lastTime >= 1000 * 10) { // A cada 10 segundos
        const fps = frameCount / 10;
        console.log("FPS:", fps);

        frameCount = 0;
        lastTime = now;
    }

}

// Executa
init();
