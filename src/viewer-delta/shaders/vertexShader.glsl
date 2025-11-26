// #version 300 es (Injetado pelo Three.js)
precision highp float;
precision highp int;
precision highp usampler2D;

// Atributos Específicos (Delta Encoding)
in uint a_packed_delta;

// Uniforms de Descompressão
uniform usampler2D u_anchors;
uniform vec2 u_textureSize;
uniform int u_blockSize;

// Saída
out vec3 v_viewNormal;

void main() {
    // 1. Vertex Pulling (Recuperação da Âncora na Textura)
    // Calcula coordenadas da textura baseadas no ID do vértice e tamanho do bloco
    int blockID = gl_VertexID / u_blockSize;
    int texWidth = int(u_textureSize.x);
    ivec2 texCoord = ivec2(blockID % texWidth, blockID / texWidth);
    
    // Busca a posição base (Anchor) sem filtragem linear
    vec3 anchor = vec3(texelFetch(u_anchors, texCoord, 0).xyz);

    // 2. Desempacotamento do Delta (Bitwise Operations)
    // Extrai 3 componentes de 10 bits de um único uint32
    // Máscara 0x3FFu = 1023
    float dx = float((a_packed_delta >> 22u) & 0x3FFu);
    float dy = float((a_packed_delta >> 12u) & 0x3FFu);
    float dz = float((a_packed_delta >> 2u)  & 0x3FFu);

    // Centraliza o range [0..1023] para [-512..511] e soma à âncora
    vec3 positionLocal = anchor + (vec3(dx, dy, dz) - 512.0);

    // 3. Renderização Padrão
    v_viewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(positionLocal, 1.0);
}
