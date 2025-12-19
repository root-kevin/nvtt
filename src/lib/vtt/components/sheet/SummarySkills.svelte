<script>
    export let sheet = null;

    function format(val) {
        if (val == null) return "—";
        return val >= 0 ? `+${val}` : `${val}`;
    }

    function iconId(name) {
        return `icon-skill-${name.replace(/\s+/g, "-")}`;
    }
</script>

<div class="card skills-card">
    <div class="card-title">Skills</div>
    <div class="summary-skills-grid">
        {#if sheet?.skills}
            {#each Object.entries(sheet.skills) as [name, value]}
                <div class="skill-pill">
                    <div class="left">
                        <svg class="skill-icon">
                            <use href={`/icons/skills.svg#${iconId(name)}`} />
                        </svg>
                        <span class="name">{name}</span>
                    </div>
                    <div class="right">{format(value)}</div>
                </div>
            {/each}
        {:else}
            <div class="skill-pill">
                <span class="name">No skills</span>
            </div>
        {/if}
    </div>
</div>
