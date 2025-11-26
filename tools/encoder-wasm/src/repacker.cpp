#include <cstdint>
#include <cstddef>
#include <emscripten/emscripten.h>

extern "C" {

    // Tamanho do bloco fixo para alinhamento com o shader.
    int BLOCK_SIZE = 64; // Valor padrão, pode ser alterado em tempo de execução.

    /*
     * Função Auxiliar: Set Block Size
     * Permite ajustar o tamanho do bloco em tempo de execução.
     */
    EMSCRIPTEN_KEEPALIVE
    void set_block_size(int new_block_size) {
        BLOCK_SIZE = new_block_size;
    }

    /*
     * Função Principal: Repack
     * Compacta os vértices usando Delta Encoding e gera tabela de remapeamento.
     */
    EMSCRIPTEN_KEEPALIVE
    int repack_mesh_uint16(
        size_t vertex_count,
        unsigned short* input_uint16,
        unsigned short* output_anchors,
        uint32_t* output_packed,
        uint32_t* output_remap,     // <--- NOVO: Tabela de Remapeamento (De -> Para)
        int input_stride,
        int max_output_size
    ) {
        int idx_block = -1;
        int idx_packed = 0;
        
        for (size_t i = 0; i < vertex_count; i++) {
            
            // 1. Proteção de Memória
            if (idx_packed >= max_output_size) return -1; // Erro: Buffer insuficiente

            // 2. Leitura dos dados originais
            unsigned short x = input_uint16[i * input_stride + 0];
            unsigned short y = input_uint16[i * input_stride + 1];
            unsigned short z = input_uint16[i * input_stride + 2];

            // 3. Verifica se é início de bloco (Natural ou Pós-Padding)
            if (idx_packed % BLOCK_SIZE == 0) {
                idx_block++;
                // Define a âncora usando o vértice atual como base
                output_anchors[idx_block * 3 + 0] = x;
                output_anchors[idx_block * 3 + 1] = y;
                output_anchors[idx_block * 3 + 2] = z;
            }

            // 4. Cálculo do Delta (Centralizado em 512 para o range 0..1023)
            int32_t delta_x = 512 + x - output_anchors[idx_block * 3 + 0];
            int32_t delta_y = 512 + y - output_anchors[idx_block * 3 + 1];
            int32_t delta_z = 512 + z - output_anchors[idx_block * 3 + 2];

            // 5. Verificação de Estouro (Overflow dos 10 bits)
            // A máscara 0xFFFFFC00 verifica se há bits fora do range [0, 1023]
            if ((delta_x & 0xFFFFFC00) || (delta_y & 0xFFFFFC00) || (delta_z & 0xFFFFFC00)) {
                
                // ESTOURO DETECTADO:
                // Preenche com "Padding" (Lixo) até fechar o bloco atual de 96.
                // Isso força o próximo vértice a cair no índice 0 do próximo bloco,
                // criando obrigatoriamente uma nova âncora.
                while (idx_packed % BLOCK_SIZE != 0) {
                    if (idx_packed >= max_output_size) return -1;
                    
                    output_packed[idx_packed] = 0; // Valor irrelevante (nunca será lido pelos índices)
                    idx_packed++;
                }
                
                // Decrementa 'i' para tentar processar este mesmo vértice novamente
                // na próxima iteração (onde ele será o primeiro do novo bloco).
                i--; 
            }
            else {
                // SUCESSO: O delta cabe no bloco atual.
                
                // Empacota: X (10 bits) | Y (10 bits) | Z (10 bits)
                output_packed[idx_packed] = ((uint32_t)delta_x << 22) | 
                                            ((uint32_t)delta_y << 12) | 
                                            ((uint32_t)delta_z << 2); 
                
                // <--- O PULO DO GATO: Tabela de Remapeamento
                // Anotamos: "O vértice original 'i' agora mora no endereço 'idx_packed'"
                output_remap[i] = idx_packed;

                idx_packed++;
            }
        }

        return idx_packed; // Retorna o tamanho real final (incluindo padding)
    }

    /*
     * Função Auxiliar: Apply Remap
     * Atualiza o buffer de índices usando a tabela gerada acima.
     */
    EMSCRIPTEN_KEEPALIVE
    void apply_remap(
        size_t index_count,
        uint32_t* indices,      // Buffer de índices originais (Entrada e Saída)
        uint32_t* remap_table   // Tabela de tradução (Input)
    ) {
        for (size_t i = 0; i < index_count; i++) {
            // Lê o índice antigo -> Busca na tabela -> Escreve o novo endereço
            indices[i] = remap_table[indices[i]];
        }
    }


    /*
     * Suporta índices de 2 bytes (Uint16) ou 4 bytes (Uint32)
     * index_stride: 2 para Uint16, 4 para Uint32
     */
    EMSCRIPTEN_KEEPALIVE
    void apply_remap_generic(
        size_t index_count,
        void* indices,          // void* para aceitar qualquer tipo
        uint32_t* remap_table,
        int index_stride        // 2 ou 4
    ) {
        if (index_stride == 2) {
            unsigned short* idx16 = (unsigned short*)indices;
            for (size_t i = 0; i < index_count; i++) {
                idx16[i] = (unsigned short)remap_table[idx16[i]];
            }
        } else {
            uint32_t* idx32 = (uint32_t*)indices;
            for (size_t i = 0; i < index_count; i++) {
                idx32[i] = remap_table[idx32[i]];
            }
        }
    }
}