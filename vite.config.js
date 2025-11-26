import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    root: 'src',            // Raiz do código-fonte
    publicDir: '../assets', // Arquivos estáticos servidos na raiz '/'

    build: {
        outDir: '../dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                // Hub de navegação
                main: resolve(__dirname, 'src/index.html'),
                
                // Visualizador Padrão (Meshopt)
                standard: resolve(__dirname, 'src/viewer-standard/index.html'),
                
                // Visualizador Delta (Experimental)
                delta: resolve(__dirname, 'src/viewer-delta/index.html'),
            },
        },
    },

    server: {
        open: true // Abre o navegador automaticamente no Hub
    }
});
