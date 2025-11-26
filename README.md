# INF2008 - Otimização de Malhas 3D para Web

Este projeto investiga técnicas de renderização de malhas densas na web, comparando o pipeline padrão (GLTFLoader + Meshopt) com uma técnica experimental de Delta Encoding para redução de VRAM.

O projeto contém dois visualizadores:

- **Viewer Standard:** Renderização clássica otimizada.
- **Viewer Delta:** Renderização experimental usando descompressão via Shader.

## 1. Clonagem e Preparação

Este repositório utiliza **Git LFS** para armazenar os modelos originais de alta resolução. Após clonar, é necessário baixar os arquivos reais:

```bash
git clone <url-do-repo>
cd INF2008_meshoptimizer
git lfs pull
```

## 2. Instalação de Dependências (Web)

O projeto utiliza Vite para servir a aplicação. Certifique-se de ter o [Node.js](https://nodejs.org/) instalado e execute:

```bash
npm install
```

## 3. Gerando Assets (Pipeline)

Para processar o modelo original `.ply` e gerar os arquivos otimizados para a web, você precisará das seguintes ferramentas no seu PATH:

1. [Blender](https://www.blender.org/download/) (versão utilizada: Blender 4.5.4 LTS)
2. [gltfpack](https://github.com/zeux/meshoptimizer/releases) (versão utilizada: gltfpack 0.25)

** Passo A: Gerar arquivos GLB e Chunked GLB**

Execute o script Python via Blender para corrigir normais e gerar o particionamento (chunks):

```bash
blender --background --python scripts/builder.py
```

Os arquivos gerados na pasta `assets/lucy` serão:
- `lucy.glb`: O modelo GLB bruto.
- `lucy.chunked.glb`: O modelo GLB fatiado em chunks para otimização.

** Passo B: Otimização com gltfpack**

Para gerar versões otimizadas dos arquivos GLB, utilize os seguintes comandos:

```bash
gltfpack -i assets/lucy/lucy.glb -o assets/lucy/lucy.opt.glb -cc
gltfpack -i assets/lucy/lucy.chunked.glb -o assets/lucy/lucy.chunked.opt.glb -kn -cc
```

Os arquivos otimizados serão:
- `lucy.opt.glb`: Versão otimizada do modelo GLB.
- `lucy.chunked.opt.glb`: Versão otimizada do modelo GLB fatiado em chunks.

## 4. Compilação Wasm (Opcional)

Este passo só é necessário se você alterar o código C++ em `tools/encoder-wasm/src/repacker.cpp`. O projeto já inclui os binários compilados em src/lib.

Pré-requisito: [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) instalado e ativo no terminal.

Para compilar o código C++ para WebAssembly, execute o script de build apropriado para o seu sistema operacional.

- Windows:

    ```bash
    tools\encoder-wasm\build.bat
    ```

- Linux ou MacOS:

    ```bash
    chmod +x tools/encoder-wasm/build.sh
    tools/encoder-wasm/build.sh
    ```

Isso atualiza os arquivos em `src/lib/repacker`.

## 5. Executando o Projeto

Para iniciar o servidor de desenvolvimento local:

```bash
npm run dev
```

Acesse `http://localhost:5173` no seu navegador. Você verá um menu para escolher entre o *Viewer Standard* e o *Viewer Delta*.

---

## Notas de Desenvolvimento

- *Performance:* É possível usar a ferramenta de "Inspecionar" do navegador (geralmente acessível através da tecla F12) para monitorar o console, onde é exibido o uso de memória e o tempo de carregamento dos modelos 3D, além do FPS (frames por segundo) durante a visualização dos modelos.

- *Trocando Modelos:* Para testar outros modelos (original, otimizado, fatiado, etc.), edite a constante `CONFIG.assets.model` no arquivo `main.js` de cada visualizador (`src/viewer-standard/main.js` ou `src/viewer-delta/main.js`).
