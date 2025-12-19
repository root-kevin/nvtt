<script>
    export let skills = [];
</script>

<div class="card skills-card">
    <div class="card-title">Skills</div>
    <div class="summary-skills-grid">
        {#each skills as skill}
            <div class={`skill ${skill.mod == null ? "dim" : ""}`}>
                <span class="skill-label">{skill.name}</span>
                <span class="skill-value">
                    {skill.mod == null ? "—" : skill.mod >= 0 ? `+${skill.mod}` : skill.mod}
                </span>
            </div>
        {/each}
    </div>
</div>

<style>
    .card {
        background: #0d121e;
        border-radius: 12px;
        border: 1px solid #202839;
        padding: 10px;
        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    }
    .card-title {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #d1c184;
        margin-bottom: 8px;
    }
    .skills-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
    }
    .skill {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid #1f2533;
        background: rgba(6,8,14,0.7);
        font-size: 0.9rem;
        text-transform: capitalize;
    }
    .skill.dim {
        opacity: 0.55;
    }
    .skill-label {
        color: #cfd5e3;
    }
    .skill-value {
        color: #f1e6c4;
        font-weight: 700;
    }
</style>
