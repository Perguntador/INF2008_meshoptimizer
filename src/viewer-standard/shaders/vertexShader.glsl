// Varyings (Output para o Fragment Shader)
out vec3 v_viewNormal;

void main() {
    // 1. Calcula a normal no espaço da câmera (View Space) para o efeito Matcap.
    // 'normal' e 'normalMatrix' são atributos injetados automaticamente pelo Three.js.
    v_viewNormal = normalize(normalMatrix * normal);

    // 2. Projeção padrão de posição.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
