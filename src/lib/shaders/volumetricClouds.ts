/**
 * Volumetric Cloud Shader
 *
 * Ray-marched volumetric clouds with:
 * - Multiple noise octaves for realistic shape
 * - Light scattering and self-shadowing
 * - Time-of-day coloring
 * - Altitude-based density
 */

export const volumetricCloudVertexShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;

void main() {
    vLocalPosition = position;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const volumetricCloudFragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uCloudDensity;
uniform float uCloudCoverage;
uniform float uCloudAltitude;
uniform float uViewerAltitude;

varying vec3 vWorldPosition;
varying vec3 vLocalPosition;

// Hash and noise functions
float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
        f.z
    );
}

// Fractal Brownian Motion for cloud shapes
float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;

    for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    return value;
}

// Cloud density at a point
float cloudDensity(vec3 p) {
    // Animate clouds
    vec3 animP = p + vec3(uTime * 50.0, 0.0, uTime * 20.0);

    // Base cloud shape
    float density = fbm(animP * 0.0001);

    // Add detail
    density += fbm(animP * 0.0003) * 0.5;
    density += fbm(animP * 0.001) * 0.25;

    // Coverage threshold
    density = smoothstep(1.0 - uCloudCoverage, 1.0, density);

    // Altitude falloff (clouds at specific altitude band)
    float altDiff = abs(p.y - uCloudAltitude);
    float altFalloff = 1.0 - smoothstep(0.0, 3000.0, altDiff);

    return density * altFalloff * uCloudDensity;
}

// Ray march through cloud volume
vec4 rayMarchClouds(vec3 rayOrigin, vec3 rayDir) {
    float stepSize = 500.0;
    int maxSteps = 32;

    vec4 result = vec4(0.0);
    float transmittance = 1.0;

    // Find cloud layer intersection
    float tMin = (uCloudAltitude - 2000.0 - rayOrigin.y) / rayDir.y;
    float tMax = (uCloudAltitude + 2000.0 - rayOrigin.y) / rayDir.y;

    if (tMin > tMax) {
        float temp = tMin;
        tMin = tMax;
        tMax = temp;
    }

    if (tMax < 0.0) return vec4(0.0);
    tMin = max(0.0, tMin);

    float t = tMin;

    for (int i = 0; i < maxSteps; i++) {
        if (t > tMax || transmittance < 0.01) break;

        vec3 pos = rayOrigin + rayDir * t;
        float density = cloudDensity(pos);

        if (density > 0.001) {
            // Light calculation
            float lightMarch = 0.0;
            vec3 lightPos = pos;

            // March toward sun for self-shadowing
            for (int j = 0; j < 4; j++) {
                lightPos += uSunDirection * 300.0;
                lightMarch += cloudDensity(lightPos);
            }

            float lightTransmittance = exp(-lightMarch * 0.5);

            // Powder effect (brighter edges)
            float powder = 1.0 - exp(-density * 2.0);

            // Beer's law for cloud opacity
            float beer = exp(-density * stepSize * 0.001);

            // Silver lining effect
            float sunAngle = max(0.0, dot(rayDir, uSunDirection));
            float silverLining = pow(sunAngle, 8.0) * lightTransmittance;

            // Cloud color based on sun
            vec3 cloudColor = mix(
                vec3(0.6, 0.65, 0.75),  // Shadow color
                uSunColor * 1.2,         // Lit color
                lightTransmittance * powder
            );

            // Add silver lining
            cloudColor += vec3(1.0, 0.95, 0.9) * silverLining * 0.5;

            // Accumulate
            float alpha = (1.0 - beer) * transmittance;
            result.rgb += cloudColor * alpha;
            result.a += alpha;
            transmittance *= beer;
        }

        t += stepSize;
    }

    return result;
}

void main() {
    vec3 rayDir = normalize(vWorldPosition - cameraPosition);

    // Skip if looking away from clouds
    if (rayDir.y < -0.2 && uViewerAltitude < uCloudAltitude) {
        discard;
    }

    vec4 clouds = rayMarchClouds(cameraPosition, rayDir);

    if (clouds.a < 0.01) {
        discard;
    }

    gl_FragColor = vec4(clouds.rgb, clouds.a);
}
`;

export const volumetricCloudUniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: [0.5, 0.5, 0.5] },
    uSunColor: { value: [1.0, 0.95, 0.9] },
    uCloudDensity: { value: 1.0 },
    uCloudCoverage: { value: 0.5 },
    uCloudAltitude: { value: 8000 },
    uViewerAltitude: { value: 35000 }
};
