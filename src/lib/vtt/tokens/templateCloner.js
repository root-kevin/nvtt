// src/lib/vtt/tokens/templateCloner.js
import { get } from "svelte/store";
import { tokenLibrary, addTemplate } from "$lib/vtt/tokens/library.js";
import { sanitizeTemplateDeep } from "$lib/vtt/tokens/library.js";

/**
 * Creates a FULL individual template from a species template.
 * 
 * Rules:
 * - Copies ALL species stat fields (every allowed template key)
 * - Removes ALL instance/override fields (x, y, hp override, shortName, etc.)
 * - Assigns a new UUID
 * - Sets templateSource = "individual"
 * - Links to baseTemplateId + originalName
 * - Saves into library.json
 */
export async function cloneTemplateAsIndividual(individualName, baseTemplateId) {
    const lib = get(tokenLibrary);
    const base = lib.find(t => t.id === baseTemplateId);

    if (!base) {
        console.warn("cloneTemplateAsIndividual: base template not found", baseTemplateId);
        return null;
    }

    // Copy ALL valid template fields from base
    const cleanBase = sanitizeTemplateDeep(base);

    // Generate new unique template ID
    const newId =
        globalThis.crypto?.randomUUID?.() ??
        `ind-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Build individual template
    const individual = {
        ...cleanBase,
        id: newId,
        name: individualName,
        templateSource: "individual",
        baseTemplateId: base.id,
        originalName: base.name
    };

    await addTemplate(individual);

    return individual;
}
