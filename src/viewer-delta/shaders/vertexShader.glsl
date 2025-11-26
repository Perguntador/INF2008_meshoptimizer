// #version 300 es

// Define precisão padrão para floats e ints (boa prática)
precision highp float;
precision highp int;
precision highp usampler2D;

// Atributo customizado
in uint a_packed_delta; 

// Uniformes
uniform usampler2D u_anchors; 
uniform vec2 u_textureSize;
uniform int u_blockSize;

// --- SAÍDAS (Varyings) ---
out vec3 v_viewNormal;

void main() {
    // 1. Identifica o endereço na memória
    // Como usamos índices remapeados, gl_VertexID é o valor do índice (ex: 96, 97...)
    // Ele pula automaticamente os índices de padding que não existem no buffer de índices.
    int vertexID = gl_VertexID;
    
    // 2. Identifica o Bloco (Sincronizado com C++ BLOCK_SIZE = 96)
    int blockID = vertexID / u_blockSize; 

    // 3. Coordenadas da Textura (Mapeamento 1D -> 2D)
    int texWidth = int(u_textureSize.x);
    int tx = blockID % texWidth;
    int ty = blockID / texWidth;

    // 4. Busca a Âncora (Vertex Pulling)
    // texelFetch lê o pixel exato (x,y) sem filtro linear.
    // Retorna uvec4, pegamos .xyz e convertemos para float.
    vec3 anchor = vec3(texelFetch(u_anchors, ivec2(tx, ty), 0).xyz);

    // 5. Desempacota Delta (10 bits por eixo)
    // Máscara 0x3FFu = 1023 (10 bits de 1s)
    float dx = float((a_packed_delta >> 22u) & 0x3FFu);
    float dy = float((a_packed_delta >> 12u) & 0x3FFu);
    float dz = float((a_packed_delta >> 2u)  & 0x3FFu);
    
    // Desloca o range [0..1023] para [-512..511]
    vec3 delta = vec3(dx, dy, dz) - 512.0; 

    // 6. Posição Final (Espaço do Objeto em Inteiros 0..65535)
    vec3 finalPos = anchor + delta;

    // 7. Renderiza
    // A escala (divisão por 65535 e ajuste de tamanho) deve vir da 
    // modelViewMatrix (aplicando mesh.scale no JS).
    
    // Passa normal para o fragment shader (Matcap)
    v_viewNormal = normalize(normalMatrix * normal);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
}
