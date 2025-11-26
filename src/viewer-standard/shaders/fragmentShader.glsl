precision mediump float;

// Uniforms e Varyings
uniform sampler2D u_matcap; // Textura MatCap carregada via JS
in vec3 v_viewNormal;       // Normal interpolada recebida do Vertex Shader

void main() {
    // 1. Mapeamento Esférico (Matcap UV)
    // Converte a normal de View Space [-1, 1] para coordenadas de textura [0, 1]
    vec2 uv = v_viewNormal.xy * 0.5 + 0.5;

    // 2. Amostragem da Textura
    // Nota: texture2D é legado (GLSL 1.0), mas mantido aqui por compatibilidade com ShaderMaterial padrão
    vec4 color = texture2D(u_matcap, uv);

    // 3. Saída final
    gl_FragColor = vec4(color.rgb, 1.0);
}