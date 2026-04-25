<script lang="ts">
    interface Props {
        label: string;
        value: number;
        min: number;
        max: number;
        step: number;
        id?: string;
        formatValue?: (v: number) => string;
        oninput: (e: Event & { currentTarget: HTMLInputElement }) => void;
    }

    let {
        label,
        value,
        min,
        max,
        step,
        id,
        formatValue = (v) => v.toString(),
        oninput,
    }: Props = $props();
</script>

<div class="control">
    <label for={id}>{label}: {formatValue(value)}</label>
    <input {id} type="range" {min} {max} {step} {value} {oninput} />
</div>

<style>
    .control {
        margin-bottom: 0;
    }

    .control label {
        display: block;
        font-size: 0.75rem;
        opacity: 0.8;
        margin-bottom: 0.4rem;
        font-weight: 400;
        letter-spacing: 0.02em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    }

    .control input[type="range"] {
        width: 100%;
        /* Reset default appearance */
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
        cursor: pointer;
        height: 14px; /* Track height area */
    }

    /* Track Styling */
    .control input[type="range"]::-webkit-slider-runnable-track {
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 2px;
        transition: background 0.2s;
    }

    .control input[type="range"]:hover::-webkit-slider-runnable-track {
        background: rgba(255, 255, 255, 0.3);
    }

    /* Thumb Styling */
    .control input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        margin-top: -10px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: white;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(0, 0, 0, 0.1);
        transition: transform 0.1s;
    }

    .control input[type="range"]:active::-webkit-slider-thumb {
        transform: scale(1.15);
        background: var(--sw-blue);
        border-color: white;
    }

    /* Firefox styles */
    .control input[type="range"]::-moz-range-track {
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 2px;
    }

    .control input[type="range"]::-moz-range-thumb {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: white;
        border: none;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
</style>
