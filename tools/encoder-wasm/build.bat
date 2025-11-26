@echo off
setlocal

echo ==========================================
echo [WIN] Compilando Repacker (WASM) para Shared Lib...
echo ==========================================

:: 1. Definição de Caminhos (Relativos ao script)
:: A pasta de destino agora é a biblioteca compartilhada
set "SOURCE_FILE=tools\encoder-wasm\src\repacker.cpp"
set "BUILD_DIR=tools\encoder-wasm\build"
set "DEST_DIR=src\lib\repacker"

:: 2. Cria diretórios se não existirem
:: O comando mkdir cria a árvore de pastas completa (src -> lib -> repacker)
if not exist "%BUILD_DIR%" mkdir "%BUILD_DIR%"
if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"

:: 3. Verifica se o emcc está acessível
where emcc >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] O comando 'emcc' nao foi encontrado!
    echo Voce precisa rodar o 'emsdk_env.bat' antes de compilar.
    echo.
    pause
    exit /b 1
)

:: 4. Compilação
:: Gera os arquivos na pasta temporária 'build'
echo Compilando...
call emcc "%SOURCE_FILE%" ^
    -O3 ^
    -s WASM=1 ^
    -s ALLOW_MEMORY_GROWTH=1 ^
    -s MODULARIZE=1 ^
    -s EXPORT_ES6=1 ^
    -s "EXPORT_NAME='createRepacker'" ^
    -s "EXPORTED_FUNCTIONS=['_malloc','_free','_repack_mesh_uint16','_set_block_size','_apply_remap','_apply_remap_generic']" ^
    -s "EXPORTED_RUNTIME_METHODS=['cwrap','wasmMemory']" ^
    -s ENVIRONMENT=web ^
    -o "%BUILD_DIR%\repacker.js"

if %errorlevel% neq 0 (
    echo.
    echo [FALHA] Ocorreu um erro na compilacao.
    pause
    exit /b 1
)

echo [OK] Compilacao concluida em '%BUILD_DIR%'.

:: 5. Distribuição (Copia para src/lib/repacker)
echo Copiando para src/lib/repacker...
copy /Y "%BUILD_DIR%\repacker.js" "%DEST_DIR%\" >nul
copy /Y "%BUILD_DIR%\repacker.wasm" "%DEST_DIR%\" >nul

echo.
echo [SUCESSO] Arquivos atualizados em: %DEST_DIR%
echo ==========================================
pause