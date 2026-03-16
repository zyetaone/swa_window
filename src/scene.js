import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { cloudVertexShader, cloudFragmentShader } from './shaders.js';

export class WindowScene {
    constructor(container) {
        this.width = 1280;
        this.height = 720;
        
        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(1); // Force 1 for performance
        container.appendChild(this.renderer.domElement);

        // Scene & Camera
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 200000);
        this.camera.position.set(0, 10000, 0); // 10km altitude
        this.camera.rotation.x = -0.2; // Look slightly down

        // 1. Sky
        this.initSky();

        // 2. Clouds (Plane above camera)
        this.initClouds();

        // 3. Ground
        this.initGround();

        // 4. Wing (Group attached to camera for parallax)
        this.initWing();
        
        // 5. Stars (Simple particle system)
        this.initStars();

        // Resize handler
        window.addEventListener('resize', () => this.onResize());
    }

    initSky() {
        this.sky = new Sky();
        this.sky.scale.setScalar(450000);
        this.scene.add(this.sky);
        
        this.sunPosition = new THREE.Vector3();
        this.skyUniforms = this.sky.material.uniforms;
        this.skyUniforms['turbidity'].value = 10;
        this.skyUniforms['rayleigh'].value = 3;
        this.skyUniforms['mieCoefficient'].value = 0.005;
        this.skyUniforms['mieDirectionalG'].value = 0.7;
    }

    initClouds() {
        const geometry = new THREE.PlaneGeometry(50000, 50000);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 500, 0); // Slightly above camera

        this.cloudMaterial = new THREE.ShaderMaterial({
            vertexShader: cloudVertexShader,
            fragmentShader: cloudFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uCoverage: { value: 0.5 },
                uSpeed: { value: 0.2 },
                uColor: { value: new THREE.Color(0xffffff) }
            },
            transparent: true,
            depthWrite: false
        });

        this.clouds = new THREE.Mesh(geometry, this.cloudMaterial);
        this.scene.add(this.clouds);
    }

    initGround() {
        // Placeholder ground - in real app, use map tiles
        const geometry = new THREE.PlaneGeometry(100000, 100000);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, -10000, 0); // At sea level (0), camera is at 10000

        // Create a checkerboard grid texture
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#2a4b2a'; // Dark green
        ctx.fillRect(0,0,512,512);
        ctx.fillStyle = '#3a5b3a';
        for(let i=0;i<8;i++) {
            for(let j=0;j<8;j++) {
                if((i+j)%2===0) ctx.fillRect(i*64, j*64, 64, 64);
            }
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(50, 50);

        this.groundMaterial = new THREE.MeshBasicMaterial({ map: texture });
        this.ground = new THREE.Mesh(geometry, this.groundMaterial);
        this.scene.add(this.ground);
    }

    initWing() {
        // We attach the wing to the camera so it stays in view
        // But we give it a slight offset logic in the render loop for parallax
        const loader = new THREE.TextureLoader();
        
        // Try to load wing.png, fallback to a colored plane if missing
        loader.load('/assets/wing.png', (tex) => {
            const geometry = new THREE.PlaneGeometry(10, 5);
            const material = new THREE.MeshBasicMaterial({ 
                map: tex, transparent: true, side: THREE.DoubleSide 
            });
            this.wing = new THREE.Mesh(geometry, material);
            
            // Position relative to camera frustum
            this.wing.position.set(3, -1.5, -5); 
            this.wing.rotation.set(0.2, -0.2, 0.1);
            this.camera.add(this.wing);
            this.scene.add(this.camera); // Must add camera to scene if it has children
        }, undefined, () => {
            console.warn("Wing texture not found, skipping wing.");
        });
    }

    initStars() {
        const r = 80000;
        const starsGeometry = new THREE.BufferGeometry();
        const starsVertices = [];
        for ( let i = 0; i < 2000; i ++ ) {
            const x = THREE.MathUtils.randFloatSpread( 2 * r );
            const y = THREE.MathUtils.randFloatSpread( 2 * r );
            const z = THREE.MathUtils.randFloatSpread( 2 * r );
            starsVertices.push( x, y, z );
        }
        starsGeometry.setAttribute( 'position', new THREE.Float32BufferAttribute( starsVertices, 3 ) );
        this.starMaterial = new THREE.PointsMaterial( { color: 0xffffff, transparent: true, opacity: 0 } );
        this.starField = new THREE.Points( starsGeometry, this.starMaterial );
        this.scene.add( this.starField );
    }

    updateSun(azimuth, elevation, visuals) {
        const phi = THREE.MathUtils.degToRad( 90 - elevation );
        const theta = THREE.MathUtils.degToRad( azimuth );
        this.sunPosition.setFromSphericalCoords( 1, phi, theta );
        
        this.skyUniforms['sunPosition'].value.copy( this.sunPosition );
        this.skyUniforms['turbidity'].value = visuals.turbidity;
        this.skyUniforms['mieCoefficient'].value = visuals.mieCoefficient;
        
        // Update lighting on ground (hacky dimming)
        this.groundMaterial.color.setScalar(visuals.sunIntensity);
        this.starMaterial.opacity = visuals.starAlpha;
    }

    updateClouds(visuals, delta) {
        this.cloudMaterial.uniforms.uTime.value += delta;
        this.cloudMaterial.uniforms.uCoverage.value = visuals.cloudCoverage;
        this.cloudMaterial.uniforms.uSpeed.value = visuals.cloudSpeed;
        
        // Darken clouds at night
        const cVal = Math.max(visuals.sunIntensity, 0.2);
        this.cloudMaterial.uniforms.uColor.value.setRGB(cVal, cVal, cVal);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
    
    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
}
