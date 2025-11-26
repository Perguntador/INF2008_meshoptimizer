# INF2008_meshoptimizer

## Gerando assets

Para gerar os assets necessários para o projeto, siga os passos abaixo:

Certifique-se de que a maquina possui o [Blender](https://www.blender.org/download/) e o [gltfpack](https://github.com/zeux/meshoptimizer/releases) instalados e disponíveis no PATH do seu sistema.

Execute o seguinte comando no terminal dentro do diretório `INF2008_meshoptimizer`:

```
blender --background --python scripts/builder.py
```

Isso irá processar o arquivo PLY original e gerar os arquivos GLB necessários na pasta `assets`.

Os arquivos gerados serão:
- `lucy.glb`: O modelo GLB bruto.
- `lucy.chunked.glb`: O modelo GLB fatiado em chunks para otimização.


Para gerar versões otimizadas dos arquivos GLB, utilize os seguintes comandos:

```
gltfpack -i assets/lucy.glb -o assets/lucy.opt.glb -cc
gltfpack -i assets/lucy.chunked.glb -o assets/lucy.chunked.opt.glb -kn -cc
```

Os arquivos otimizados serão:
- `lucy.opt.glb`: Versão otimizada do modelo GLB.
- `lucy.chunked.opt.glb`: Versão otimizada do modelo GLB fatiado em chunks.

