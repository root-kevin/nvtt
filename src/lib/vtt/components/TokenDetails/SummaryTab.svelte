<script>
    import SummaryAbilities from "../sheet/SummaryAbilities.svelte";
    import SummarySaves from "../sheet/SummarySaves.svelte";
    import SummarySkills from "../sheet/SummarySkills.svelte";
    import SummarySenses from "../sheet/SummarySenses.svelte";
    import SummaryDefenses from "../sheet/SummaryDefenses.svelte";
    import VisionSection from "./VisionSection.svelte";
    import { formatEntryNode, formatType } from "$lib/vtt/5e/normalizeSheet.js";

    export let token;
    export let sheet;
    export let overrides = {};
    export let currentHp = 0;
    export let maxHp = 1;
    export let tempHp = 0;
    export let mapLighting = true;
    export let readOnly = false;

    // callbacks from TokenDetails
    export let onHpChange = () => {};
    export let onAbilityBatch = () => {};
    export let onNameChange = () => {};
    export let togglePersistentHp = () => {};
    export let onVisionUpdate = () => {};
    export let hasPersistentHp = false;
    export let mode = "token"; // "token" | "template"

    let hpDelta = "";
    let activeSubTab = "abilities";
    let nameDraft = "";
    let acDraft = "";
    let hpCurrentDraft = 0;
    let hpMaxDraft = 1;
    let hpTempDraft = 0;
    let speedDraft = {};
    let lastNameTokenId = null;
    let lastSpeedTokenId = null;
    let lastNameSnapshot = "";
    let lastAcSnapshot = null;
    let lastSpeedSnapshot = "";

    $: displayName = token?.name || overrides?.meta?.name || sheet?.meta?.name || "";
    $: acNumber = sheet?.meta?.ac ?? token?.ac;
    $: acFrom = sheet?.meta?.acFrom;
    $: displayCr = formatCr(sheet?.meta?.cr);
    $: displaySource = formatSource(sheet?.meta?.source ?? token?.templateSource);
    $: displayType = formatType(sheet?.meta?.type);

    $: {
        if (token?.id !== lastNameTokenId || displayName !== lastNameSnapshot) {
            nameDraft = displayName || "";
            lastNameSnapshot = displayName || "";
            lastNameTokenId = token?.id;
        }
    }

    $: {
        const nextAc = acNumber ?? "";
        if (nextAc !== lastAcSnapshot) {
            acDraft = nextAc;
            lastAcSnapshot = nextAc;
        }
    }

    $: if (currentHp != null) hpCurrentDraft = currentHp;
    $: if (maxHp != null) hpMaxDraft = maxHp;
    $: if (tempHp != null) hpTempDraft = tempHp;

    $: {
        const baseSpeed = sheet?.meta?.speed ?? token?.speed ?? {};
        const nextSnapshot = JSON.stringify(baseSpeed ?? {});
        if (token?.id !== lastSpeedTokenId || nextSnapshot !== lastSpeedSnapshot) {
            speedDraft = normalizeSpeed(baseSpeed);
            lastSpeedSnapshot = nextSnapshot;
            lastSpeedTokenId = token?.id;
        }
    }

    $: speedEntries = toSpeedEntries(speedDraft);
    $: rawSheet = sheet?.raw || {};
    $: proficiencyRows = buildProficiencyRows(rawSheet);

    function normalizeSpeed(speed) {
        if (speed == null) return {};
        if (typeof speed === "number") return { walk: speed };
        if (typeof speed === "string") {
            const parsed = parseInt(speed, 10);
            return Number.isFinite(parsed) ? { walk: parsed } : {};
        }
        if (typeof speed === "object") return { ...speed };
        return {};
    }

    function toSpeedEntries(speed) {
        if (!speed || typeof speed !== "object") return [];
        const entries = [];
        const types = ["walk", "fly", "climb", "swim", "burrow"];
        const val = (v) => {
            if (typeof v === "number") return v;
            if (typeof v === "object" && v.number != null) return v.number;
            return null;
        };
        types.forEach((type) => {
            if (speed[type] == null) return;
            const raw = speed[type];
            const n = val(raw);
            const condition = typeof raw === "object" ? raw?.condition || "" : "";
            const displayType = type === "walk" ? "walk" : type;
            const display = `${displayType}${displayType === "walk" ? "" : ""} ${n ?? raw} ft.${condition ? ` ${condition}` : ""}`;
            entries.push({ type, value: n ?? raw, condition, display });
        });
        return entries;
    }

    function formatCr(cr) {
        if (cr == null) return "—";
        if (typeof cr === "number") return `${cr}`;
        if (typeof cr === "string") return cr;
        return "—";
    }

    function formatSource(src) {
        if (!src) return "—";
        if (typeof src === "string") return src;
        if (typeof src === "object") {
            const code = src.source || src.abbreviation || src.abbrev || "";
            const page = src.page ? ` p. ${src.page}` : "";
            const title = src.title || "";
            return (code || title ? `${code || title}${page}` : "—");
        }
        return String(src);
    }

    function formatList(val) {
        if (!val && val !== 0) return "—";
        if (Array.isArray(val)) {
            const out = val.map(formatEntryNode).filter(Boolean).join(", ");
            return out || "—";
        }
        const out = formatEntryNode(val);
        return out || "—";
    }

    function buildProficiencyRows(raw = {}) {
        return [
            {
                label: "Languages",
                value: formatList(
                    raw.languages ?? raw.language ?? raw.languageProficiencies ?? raw.languageProficiency
                )
            },
            {
                label: "Armor",
                value: formatList(
                    raw.armorProficiencies ?? raw.armor ?? raw.armorProficiency
                )
            },
            {
                label: "Weapons",
                value: formatList(
                    raw.weaponProficiencies ?? raw.weapon ?? raw.weaponProficiency
                )
            },
            {
                label: "Tools",
                value: formatList(
                    raw.toolProficiencies ?? raw.tools ?? raw.tool ?? raw.toolProficiency
                )
            }
        ];
    }

    function handleCurrent() {
        if (readOnly) return;
        onHpChange({ setCurrent: Number.isFinite(+hpCurrentDraft) ? +hpCurrentDraft : 0 });
    }

    function handleMax() {
        if (readOnly) return;
        const parsed = Math.max(0, +hpMaxDraft || 0);
        onHpChange({ setMax: parsed });
    }

    function handleTemp() {
        if (readOnly) return;
        const parsed = Math.max(0, +hpTempDraft || 0);
        onHpChange({ setTemp: parsed });
    }

    function handleAcSave() {
        if (readOnly) return;
        onHpChange({ setAc: Number.isFinite(+acDraft) ? +acDraft : 0 });
    }

    function updateSpeedDraft(type, value) {
        const numeric = Number.isFinite(+value) ? +value : value;
        const next = { ...(speedDraft || {}) };
        if (typeof next[type] === "object" && next[type] !== null) {
            next[type] = { ...next[type], number: numeric };
        } else {
            next[type] = numeric;
        }
        speedDraft = next;
    }

    function saveSpeedEntry(entry) {
        if (readOnly) return;
        if (!entry?.type) return;
        const current = speedDraft?.[entry.type];
        const value =
            typeof current === "object"
                ? current?.number ?? entry.value
                : current ?? entry.value;
        onHpChange({
            setSpeed: {
                type: entry.type,
                value,
                condition: entry.condition
            }
        });
    }

    function runDelta(type) {
        if (readOnly) return;
        const amount = Math.abs(+hpDelta || 0);
        if (!amount) return;
        if (type === "damage") {
            onHpChange({ damage: amount });
        } else {
            onHpChange({ heal: amount });
        }
        hpDelta = "";
    }
</script>

<div class="summary">
    <div class="header-card card">
        <div class="header-top">
            <div class="portrait">
                <img src={token?.img} alt={token?.name} />
            </div>
            <div class="header-body">
                <input
                    class="name-input"
                    value={nameDraft}
                    on:input={(e) => (nameDraft = e.target.value)}
                    on:blur={() => onNameChange(nameDraft)}
                    placeholder="Name"
                    disabled={readOnly}
                />
                <div class="line tight">
                    <div class="pill-static">
                        {displayType || token?.race || "Creature"}
                    </div>
                    <div class="pill-static">
                        {sheet?.meta?.class || token?.class || ""}
                    </div>
                </div>
            </div>
        </div>

        <div class="meta-row">
            <div class="stat-pill ac-pill">
                    <div class="label icon-label">
                        <span class="icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"></path></svg>
                        </span>
                        <span>AC</span>
                    </div>
                    <input
                        class="stat-input inline"
                        type="number"
                        min="0"
                        value={acDraft}
                        on:input={(e) => (acDraft = e.target.value)}
                        on:blur={handleAcSave}
                        disabled={readOnly}
                    />
                    {#if acFrom}
                        <div class="subtext">{acFrom}</div>
                    {/if}
                </div>
            <div class="stat-pill speed-pill">
                <div class="label">SPEED</div>
                <div class="speed-list">
                    {#each speedEntries as entry}
                        <div class="speed-row">
                            <label class="speed-label">{entry.type}</label>
                            <input
                                class="stat-input inline"
                                type="number"
                                step="5"
                                min="0"
                                value={entry.value ?? ""}
                                on:input={(e) => updateSpeedDraft(entry.type, e.target.value)}
                                on:blur={() => saveSpeedEntry(entry)}
                                disabled={readOnly}
                            />
                            {#if entry.condition}
                                <span class="speed-condition">{entry.condition}</span>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
            <div class="stat-pill">
                <div class="label">CR</div>
                <input
                    class="stat-input inline"
                    type="text"
                    value={displayCr}
                    readonly
                />
            </div>
            <div class="stat-pill">
                <div class="label">SOURCE</div>
                <input
                    class="stat-input inline"
                    type="text"
                    value={displaySource}
                    readonly
                />
            </div>
        </div>
    </div>

    <div class="card hp-card">
        <div class="card-title">HP</div>

        {#if mode === "template" && !hasPersistentHp}
            <div class="hp-grid single">
                <div class="hp-field">
                    <div class="label">Base Max HP</div>
                    <input
                        class="stat-input"
                        type="number"
                        value={hpMaxDraft}
                        on:input={(e) => (hpMaxDraft = e.target.value)}
                        on:blur={handleMax}
                        disabled={readOnly}
                    />
                </div>
            </div>
        {:else}
            <div class="hp-grid">
                <div class="hp-field">
                    <div class="label">Current HP</div>
                    <input
                        class="stat-input"
                        type="number"
                        value={hpCurrentDraft}
                        on:input={(e) => (hpCurrentDraft = e.target.value)}
                        on:blur={handleCurrent}
                        disabled={readOnly}
                    />
                </div>
                <div class="hp-field">
                    <div class="label">Max HP</div>
                    <input
                        class="stat-input"
                        type="number"
                        value={hpMaxDraft}
                        on:input={(e) => (hpMaxDraft = e.target.value)}
                        on:blur={handleMax}
                        disabled={readOnly}
                    />
                </div>
                <div class="hp-field">
                    <div class="label">Temp HP</div>
                    <input
                        class="stat-input"
                        type="number"
                        value={hpTempDraft}
                        on:input={(e) => (hpTempDraft = e.target.value)}
                        on:blur={handleTemp}
                        disabled={readOnly}
                    />
                </div>
            </div>

            <div class="hp-controls">
                <input
                    class="delta-input"
                    type="number"
                    bind:value={hpDelta}
                    placeholder="Amount"
                    disabled={readOnly}
                />
                <button class="chip damage" on:click={() => runDelta("damage")} disabled={readOnly}>
                    Damage
                </button>
                <button class="chip heal" on:click={() => runDelta("heal")} disabled={readOnly}>
                    Heal
                </button>
                <label class="toggle">
                    <input
                        type="checkbox"
                        checked={hasPersistentHp}
                        on:change={(e) => togglePersistentHp(e.target.checked)}
                        disabled={readOnly}
                    />
                    <span>Persistent HP</span>
                </label>
            </div>
        {/if}
    </div>

    <SummaryDefenses {sheet} />

    <div class="summary-subtabs">
        <button
            class:active={activeSubTab === "abilities"}
            on:click={() => (activeSubTab = "abilities")}
            type="button"
        >
            Abilities &amp; Saves
        </button>
        <button
            class:active={activeSubTab === "skills"}
            on:click={() => (activeSubTab = "skills")}
            type="button"
        >
            Skills
        </button>
        <button
            class:active={activeSubTab === "senses"}
            on:click={() => (activeSubTab = "senses")}
            type="button"
        >
            Senses
        </button>
        <button
            class:active={activeSubTab === "proficiencies"}
            on:click={() => (activeSubTab = "proficiencies")}
            type="button"
        >
            Proficiencies &amp; Training
        </button>
    </div>

    <div class="summary-subtab-panel">
        {#if activeSubTab === "abilities"}
            <SummaryAbilities
                {sheet}
                {token}
                onBatch={onAbilityBatch}
                {readOnly}
            />
            <SummarySaves {sheet} />
        {:else if activeSubTab === "skills"}
            <SummarySkills {sheet} />
        {:else if activeSubTab === "senses"}
            <SummarySenses {sheet} />
            <VisionSection
                tokenId={token?.id}
                vision={token?.vision}
                {mapLighting}
                {mode}
                {readOnly}
                onUpdateVision={onVisionUpdate}
            />
        {:else}
            <div class="card prof-card">
                <div class="card-title">Proficiencies &amp; Training</div>
                <div class="prof-list">
                    {#each proficiencyRows as row}
                        <div class="prof-row">
                            <span class="prof-label">{row.label}</span>
                            <span class="prof-value">{row.value}</span>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</div>

<style>
    .summary {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
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
    }
    .card-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
    }
    .header-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
    }
    .header-top {
        display: flex;
        gap: 12px;
        align-items: center;
    }
    .portrait {
        width: 96px;
        height: 96px;
        border-radius: 12px;
        overflow: hidden;
        border: 2px solid rgba(255,255,255,0.08);
        flex-shrink: 0;
    }
    .portrait img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 12px;
    }
    .portrait-actions {
        display: flex;
        gap: 6px;
    }
    .ghost:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .header-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .name-input {
        width: 100%;
        background: #0b0f18;
        color: #f7f9fc;
        border: 1px solid #555065;
        border-radius: 10px;
        padding: 7px 10px;
        font-weight: 700;
        font-size: 1rem;
    }
    .line {
        display: flex;
        gap: 8px;
    }
    .line.tight {
        gap: 6px;
    }
    .pill-static {
        flex: 1;
        background: rgba(5,7,13,0.8);
        color: #e3e8f1;
        border: 1px solid #343b48;
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 0.82rem;
        text-align: center;
    }
    .meta-row {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
    }
    .stat-pill {
        background: rgba(18,25,39,0.95);
        border-radius: 12px;
        border: 1px solid #343b48;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .stat-pill input {
        max-width: 100%;
    }
    .stat-pill input::placeholder {
        color: #6f7686;
    }
    .subtext {
        font-size: 12px;
        color: #9fb0cc;
    }
    .stat-input.inline {
        width: 100%;
        height: 32px;
        font-size: 14px;
    }
    .speed-pill {
        padding: 8px 10px;
    }
    .speed-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .speed-row {
        display: grid;
        grid-template-columns: 1fr 80px auto;
        align-items: center;
        gap: 8px;
    }
    .speed-label {
        text-transform: uppercase;
        font-size: 12px;
        color: #cfd6e5;
    }
    .speed-condition {
        font-size: 12px;
        color: #9fb0cc;
        white-space: nowrap;
    }
    .icon-label {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .label {
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #a3afc5;
    }
    .stat-display {
        background: rgba(5,7,13,0.8);
        border: 1px solid #343b48;
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 0.9rem;
        min-height: 32px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .stat-display.small {
        font-size: 0.8rem;
    }
    .summary-subtabs {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
    }
    .summary-subtabs button {
        padding: 6px 8px;
        border-radius: 9px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: radial-gradient(circle at top, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.25));
        color: #d7d2c6;
        cursor: pointer;
        font-size: 0.6rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .summary-subtabs button.active {
        background: linear-gradient(to bottom, #d8b874, #b98f4b);
        color: #151108;
        border-color: rgba(255, 255, 255, 0.65);
        font-weight: 600;
    }
    .summary-subtab-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .hp-card {
        border-image: linear-gradient(90deg, #d1c184, transparent) 1;
    }
    .hp-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 8px;
    }
    .hp-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .stat-input {
        background: #070a12;
        border: 1px solid #3b4253;
        border-radius: 8px;
        padding: 6px 8px;
        color: #f7f9fc;
        font-size: 0.9rem;
    }
    .hp-controls {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .delta-input {
        flex: 1;
        background: #050812;
        color: #f7f9fc;
        border: 1px solid #343b48;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 0.9rem;
    }
    .chip {
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid #343b48;
        background: #141b29;
        color: #e9edf5;
        cursor: pointer;
        font-size: 0.85rem;
    }
    .chip.damage {
        border-color: #7a3535;
        color: #ffdddd;
    }
    .chip.heal {
        border-color: #2f7a4d;
        color: #d9ffdd;
    }
    .toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.85rem;
        color: #d7deed;
    }
    .ghost {
        background: transparent;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px;
        color: #e8ecf5;
        padding: 4px 6px;
        cursor: pointer;
    }
    .prof-list {
        display: grid;
        gap: 6px;
    }
    .prof-row {
        background: rgba(5,7,12,0.6);
        border-radius: 8px;
        padding: 6px 8px;
        border: 1px solid #1f2533;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.9rem;
        color: #d7deed;
    }
    .prof-label {
        color: #cfd5e3;
        text-transform: uppercase;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
    }
    .prof-value {
        color: #f1e6c4;
        text-align: right;
        max-width: 70%;
    }
</style>
