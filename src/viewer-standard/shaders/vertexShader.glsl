// ===================================================
// ARQUIVO: vertexShader.glsl (Corrigido para MATCAP)
// ===================================================

/*
 * 1. "out" (A Ponte Customizada)
 *
 * Vamos passar a 'Normal em Espaço de Visão'
 * para o fragment shader.
 */
out vec3 v_viewNormal;


/*
 * 2. A FUNÇÃO PRINCIPAL (main)
 *
 * Nós usamos 'normal' (injetado) e 'normalMatrix' (injetado)
 * para calcular a direção que este vértice está
 * apontando em relação à câmera.
 */
void main() {
    
    // Etapa 1: A "Ponte"
    // Calcula a normal em relação à câmera
    v_viewNormal = normalize( normalMatrix * normal );

    // Etapa 2: A Saída Obrigatória (A Posição Final)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}