<script>
  import { createEventDispatcher } from "svelte";
  import ModalFrame from "$lib/vtt/components/ModalFrame.svelte";

  export let open = false;
  export let title = "";
  export let value = null;
  export let idKey = "id";
  export let getId = null;
  export let width = 560;
  export let onSave = null;

  const dispatch = createEventDispatcher();

  let local = null;
  let lastId = null;
  let wasOpen = false;

  function resolveId(v) {
    if (typeof getId === "function") return getId(v);
    if (idKey && v && typeof v === "object" && idKey in v) return v[idKey];
    return v?.id ?? null;
  }

  function cloneValue(v) {
    if (v == null) return v;
    if (typeof structuredClone === "function") return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  $: currentId = resolveId(value);

  $: if (open && (!wasOpen || (currentId != null && currentId !== lastId))) {
    local = cloneValue(value);
    lastId = currentId;
  }

  $: wasOpen = open;

  function setLocal(next) {
    local = next;
  }

  async function triggerSave() {
    if (!local) return;
    try {
      if (typeof onSave === "function") {
        await onSave(local);
      }
      dispatch("save", { value: local });
    } catch (error) {
      dispatch("error", { error });
    }
  }

  function handleToggle() {
    triggerSave();
  }

  function handleTextBlur() {
    triggerSave();
  }

  function handleSliderRelease() {
    triggerSave();
  }
</script>

<ModalFrame
  {open}
  {title}
  {width}
  dirty={false}
  on:cancel={() => dispatch("close")}
>
  <slot
    {local}
    {setLocal}
    {triggerSave}
    {handleToggle}
    {handleTextBlur}
    {handleSliderRelease}
  />
</ModalFrame>
