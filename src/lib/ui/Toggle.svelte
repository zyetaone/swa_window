<script lang="ts">
    interface Props {
        label: string;
        checked: boolean;
        onchange: (e: Event & { currentTarget: HTMLInputElement }) => void;
    }

    let { label, checked, onchange }: Props = $props();
</script>

<label class="toggle-container">
    <div class="toggle-switch">
        <input type="checkbox" {checked} {onchange} />
        <span class="slider"></span>
    </div>
    <span class="label-text">{label}</span>
</label>

<style>
    .toggle-container {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        cursor: pointer;
        font-size: 0.8rem;
        user-select: none;
        opacity: 0.9;
        transition: opacity 0.2s;
    }

    .toggle-container:hover {
        opacity: 1;
    }

    .label-text {
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    }

    /* Switch Container */
    .toggle-switch {
        position: relative;
        width: 44px;
        height: 24px;
    }

    /* Hidden Checkbox */
    .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    /* The Slider */
    .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(255, 255, 255, 0.2);
        transition: 0.3s;
        border-radius: 24px;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .slider:before {
        position: absolute;
        content: "";
        height: 20px;
        width: 20px;
        left: 2px;
        bottom: 1px;
        background-color: white;
        transition: 0.3s;
        border-radius: 50%;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    input:checked + .slider {
        background-color: var(--sw-blue);
        border-color: rgba(255, 255, 255, 0.3);
    }

    input:checked + .slider:before {
        transform: translateX(20px);
    }
</style>
