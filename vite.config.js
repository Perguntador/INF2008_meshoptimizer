import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Define 'src' como a raiz dos arquivos fonte. 
  // Isso significa que o Vite vai procurar seus index.html dentro de src/
  root: 'src', 

  // Define onde estão os assets estáticos (modelos, texturas).
  // O Vite vai servir o conteúdo dessa pasta na URL raiz "/" do servidor.
  publicDir: '../assets', 

  build: {
    // Como mudamos o root para 'src', precisamos dizer para o build
    // sair de lá e voltar para a pasta 'dist' na raiz do projeto.
    outDir: '../dist',
    emptyOutDir: true, // Limpa a pasta dist antes de buildar
    rollupOptions: {
      input: {
        // Ponto de entrada do viewer-standard
        standard: resolve(__dirname, 'src/viewer-standard/index.html'),
      },
    },
  },

  server: {
    // Ao rodar 'npm run dev', abre direto essa página
    open: '/viewer-standard/index.html'
  }
});