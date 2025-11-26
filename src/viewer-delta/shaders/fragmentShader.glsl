
precision mediump float;

// UNIFORME
uniform sampler2D u_matcap;

// ENTRADA (Vindo do Vertex Shader)
in vec3 v_viewNormal;

// SAÍDA (Nova exigência do WebGL 2)
out vec4 FragColor;

void main() {
    // Etapa 1: Calcular o UV do Matcap
    // Normaliza de [-1, 1] para [0, 1]
    vec2 matcapUV = v_viewNormal.xy * 0.5 + 0.5;

    // Etapa 2: Ler a Textura
    // Em WebGL 2, usa-se 'texture()' em vez de 'texture2D()'
    vec4 matcapColor = texture(u_matcap, matcapUV);

    // Etapa 3: A Saída
    // Escrevemos na nossa variável de saída 'FragColor' em vez de 'gl_FragColor'
    FragColor = vec4(matcapColor.rgb, 1.0);
}
