#!/bin/bash
set -e # Aborta o script imediatamente se algum comando falhar

echo "=========================================="
echo "[LINUX/MAC] Compilando Repacker (WASM) para Shared Lib..."
echo "=========================================="

# 1. Definição de Caminhos
SOURCE_FILE="tools/encoder-wasm/src/repacker.cpp"
BUILD_DIR="tools/encoder-wasm/build"
DEST_DIR="src/lib/repacker"

# 2. Cria diretórios se não existirem (-p cria pais se necessário e não reclama se já existir)
mkdir -p "$BUILD_DIR"
mkdir -p "$DEST_DIR"

# 3. Verifica se o emcc está acessível
if ! command -v emcc &> /dev/null; then
    echo ""
    echo "[ERRO] O comando 'emcc' não foi encontrado!"
    echo "Você precisa ativar o ambiente do Emscripten (source ./emsdk_env.sh) antes de compilar."
    echo ""
    exit 1
fi

# 4. Compilação
echo "Compilando..."

# A contrabarra (\) é usada para quebra de linha no bash
emcc "$SOURCE_FILE" \
    -O3 \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s "EXPORT_NAME='createRepacker'" \
    -s "EXPORTED_FUNCTIONS=['_malloc','_free','_repack_mesh_uint16','_set_block_size','_apply_remap','_apply_remap_generic']" \
    -s "EXPORTED_RUNTIME_METHODS=['cwrap','wasmMemory']" \
    -s ENVIRONMENT=web \
    -o "$BUILD_DIR/repacker.js"

echo "[OK] Compilação concluída em '$BUILD_DIR'."

# 5. Distribuição
echo "Copiando para src/lib/repacker..."
cp "$BUILD_DIR/repacker.js" "$DEST_DIR/"
cp "$BUILD_DIR/repacker.wasm" "$DEST_DIR/"

echo ""
echo "[SUCESSO] Arquivos atualizados em: $DEST_DIR"
echo "=========================================="