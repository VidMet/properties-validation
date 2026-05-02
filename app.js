const WorkspaceAPI = window.WorkspaceAPI;
let validationRules = null;

// ==========================================
// 1. OPPSTART: Klar til bruk umiddelbart
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    const statusEl = document.getElementById("status-message");
    statusEl.classList.remove("hidden");
    statusEl.innerText = "Klar til validering!";
    statusEl.style.color = "green";
    setTimeout(() => statusEl.classList.add("hidden"), 3000);
});

// ==========================================
// 2. NÅR DU TRYKKER PÅ KNAPPEN
// ==========================================
document.getElementById("btn-validate").addEventListener("click", async () => {
    const btn = document.getElementById("btn-validate");
    const resultsList = document.getElementById("results-list");
    const resultsContainer = document.getElementById("results-container");
    const statusEl = document.getElementById("status-message");
    
    btn.disabled = true;
    resultsList.innerHTML = ""; 
    statusEl.classList.remove("hidden");

    try {
        // --- DEL A: HENT REGLER FRA GITHUB (Ingen Token nødvendig!) ---
        if (!validationRules) {
            btn.innerText = "Henter regler fra GitHub...";
            statusEl.innerText = "Laster ned 0_Element.json...";
            statusEl.style.color = "#005f9e";

            // Henter filen direkte fra GitHub-mappen din
            const response = await fetch("0_Element.json");
            if (!response.ok) throw new Error("Fant ikke 0_Element.json på GitHub!");
            
            validationRules = await response.json();
            
            statusEl.innerText = "Regler lastet inn!";
            statusEl.style.color = "green";
            setTimeout(() => statusEl.classList.add("hidden"), 2000);
        }

        // --- DEL B: VALIDER MODELLEN ---
        btn.innerText = "Validerer objekter...";

        const selection = await WorkspaceAPI.selection.getSelection();
        if (!selection || selection.length === 0) {
            throw new Error("Vennligst velg ett eller flere objekter i 3D-modellen.");
        }

        const objectsData = await WorkspaceAPI.objects.getObjects(selection);
        let totalErrors = 0;

        objectsData.forEach(obj => {
            const props = flattenProperties(obj.properties);
            const errors = runValidation(props, validationRules.properties);

            if (errors.length > 0) {
                totalErrors += errors.length;
                errors.forEach(err => {
                    const li = document.createElement("li");
                    li.innerHTML = `<strong>Objekt: ${obj.id.substring(0,8)}...</strong><br>${err}`;
                    resultsList.appendChild(li);
                });
                // Farg rød ved feil
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 255, g: 0, b: 0, a: 255 } }]);
            } else {
                // Farg grønn ved suksess
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 0, g: 255, b: 0, a: 255 } }]);
            }
        });

        resultsContainer.classList.remove("hidden");
        statusEl.classList.add("hidden");
        
        if (totalErrors === 0) {
            const li = document.createElement("li");
            li.className = "success";
            li.innerText = "Alt i orden! Objektene følger reglene.";
            resultsList.appendChild(li);
        }

    } catch (error) {
        console.error("Valideringsfeil:", error);
        statusEl.innerText = "Feil: " + error.message;
        statusEl.style.color = "red";
    } finally {
        resetBtn(btn);
    }
});

// ==========================================
// 3. HJELPEFUNKSJONER OG LOGIKK
// ==========================================
function resetBtn(btn) {
    btn.disabled = false;
    btn.innerText = "Valider valgte objekter";
}

function flattenProperties(tcProps) {
    let flat = {};
    if (!tcProps) return flat;
    tcProps.forEach(group => {
        group.properties.forEach(p => {
            flat[p.name] = p.value;
        });
    });
    return flat;
}

function runValidation(objProps, rules) {
    let errors = [];
    const fag = objProps["Underdisiplinkode"];

    for (const [propName, rule] of Object.entries(rules)) {
        const val = objProps[propName];

        let effectiveRequirement = rule.requirement || rule.defaultRequirement;
        if (rule.overrides) {
            const override = rule.overrides.find(o => o.discipline === fag);
            if (override) effectiveRequirement = override.requirement;
        }

        if (effectiveRequirement === "required" && (!val || val.toString().trim() === "")) {
            errors.push(`Mangler påkrevd egenskap: <b>${propName}</b>`);
            continue;
        }

        if (!val) continue;

        if (rule.format) {
            const regex = new RegExp(rule.format);
            if (!regex.test(val)) {
                errors.push(`Feil format på <b>${propName}</b>. Verdi: '${val}'`);
            }
        }

        if (rule.allowedValues) {
            if (Array.isArray(rule.allowedValues)) {
                if (!rule.allowedValues.includes(val)) {
                    errors.push(`Ugyldig verdi for <b>${propName}</b>: '${val}'`);
                }
            } else if (typeof rule.allowedValues === 'object' && fag) {
                if (propName === "Objektklasse") {
                    const validClasses = rule.allowedValues[fag];
                    if (!validClasses || !validClasses.includes(val)) {
                        errors.push(`Klassen '${val}' er ikke gyldig for fag '${fag}'`);
                    }
                } 
                else if (propName === "Objekttype") {
                    const klasse = objProps["Objektklasse"];
                    const validTypesForFag = rule.allowedValues[fag];
                    
                    if (validTypesForFag && validTypesForFag[klasse]) {
                        if (!validTypesForFag[klasse].includes(val)) {
                            errors.push(`Typen '${val}' er ikke gyldig for klasse '${klasse}' i fag '${fag}'`);
                        }
                    } else {
                        errors.push(`Ugyldig kombinasjon for fag '${fag}' og klasse '${klasse}'`);
                    }
                }
            }
        }
    }
    return errors;
}
