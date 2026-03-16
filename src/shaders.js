export const cloudVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const cloudFragmentShader = `
    uniform float uTime;
    uniform float uCoverage;
    uniform float uSpeed;
    uniform vec3 uColor;
    varying vec2 vUv;

    // Simple pseudo-random
    float rand(vec2 n) { 
        return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
    }

    // Noise
    float noise(vec2 p){
        vec2 ip = floor(p);
        vec2 u = fract(p);
        u = u*u*(3.0-2.0*u);
        float res = mix(
            mix(rand(ip), rand(ip+vec2(1.0,0.0)), u.x),
            mix(rand(ip+vec2(0.0,1.0)), rand(ip+vec2(1.0,1.0)), u.x), u.y);
        return res;
    }

    // FBM
    float fbm(vec2 p) {
        float f = 0.0;
        float m = 0.5;
        for(int i=0; i<5; i++){ // 5 Octaves
            f += m * noise(p); 
            p = p * 2.02; 
            m *= 0.5;
        }
        return f;
    }

    void main() {
        vec2 uv = vUv;
        // Animate
        float timeOffset = uTime * uSpeed;
        vec2 q = vec2(0.);
        q.x = fbm( uv + 0.0 * timeOffset );
        q.y = fbm( uv + vec2(1.0) );

        vec2 r = vec2(0.);
        r.x = fbm( uv + 1.0*q + vec2(1.7,9.2) + 0.15*timeOffset );
        r.y = fbm( uv + 1.0*q + vec2(8.3,2.8) + 0.126*timeOffset );

        float f = fbm(uv + r);

        // Apply coverage threshold
        float cover = smoothstep(1.0 - uCoverage, (1.0 - uCoverage) - 0.1, f);

        gl_FragColor = vec4(uColor, cover * 0.8); // Alpha 0.8 max
    }
`;
