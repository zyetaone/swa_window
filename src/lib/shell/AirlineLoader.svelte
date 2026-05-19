<script lang="ts">
    /**
     * AirlineLoader.svelte
     * Minimal SVG plane animation for transitions.
     */
</script>

<div class="loader">
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <!-- Orbit path -->
        <circle
            cx="50"
            cy="50"
            r="40"
            stroke="rgba(255,255,255,0.2)"
            stroke-width="2"
            fill="none"
        />
        <circle
            cx="50"
            cy="50"
            r="40"
            stroke="var(--sw-blue, #304CB2)"
            stroke-width="2"
            fill="none"
            stroke-dasharray="251"
            stroke-dashoffset="251"
            class="path-anim"
        />

        <!-- Plane Icon group rotating -->
        <g class="plane-group">
            <path
                d="M50 10 L55 25 L70 30 L55 35 L50 50 L45 35 L30 30 L45 25 Z"
                fill="var(--sw-yellow, #FFBF27)"
            />
        </g>
    </svg>
</div>

<style>
    .loader {
        width: 48px;
        height: 48px;
    }

    .plane-group {
        transform-origin: 50px 50px;
        animation: rotate 2s linear infinite;
    }

    .path-anim {
        animation: dash 2s ease-in-out infinite;
    }

    @keyframes rotate {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }

    @keyframes dash {
        0% {
            stroke-dashoffset: 251;
        }
        50% {
            stroke-dashoffset: 0;
        }
        100% {
            stroke-dashoffset: -251;
        }
    }
</style>
