// ===================================================
// ARQUIVO: fragmentShader.glsl (Corrigido para MATCAP)
// ===================================================

/*
 * 1. PRECISÃO
 */
precision mediump float;


/*
 * 2. UNIFORME (Vindo do JavaScript)
 *
 * A textura matcap que você carregou no 'main.js'.
 */
uniform sampler2D u_matcap;


/*
 * 3. "in" (Vindo do Vertex Shader)
 *
 * O nome DEVE corresponder ao 'out' do vertex shader.
 */
in vec3 v_viewNormal;


/*
 * 4. A FUNÇÃO PRINCIPAL (main)
 */
void main() {

    // Etapa 1: Calcular o UV do Matcap
    // Converte a normal (intervalo -1.0 a 1.0) para
    // uma coordenada de textura (intervalo 0.0 a 1.0).
    vec2 matcapUV = v_viewNormal.xy * 0.5 + 0.5;

    // Etapa 2: Ler a Textura Matcap
    // Lê a cor da sua imagem matcap usando a
    // coordenada que acabamos de calcular.
    vec4 matcapColor = texture2D(u_matcap, matcapUV);

    // Etapa 3: A Saída
    // Define a cor final do pixel.
    gl_FragColor = vec4(matcapColor.rgb, 1.0);
}