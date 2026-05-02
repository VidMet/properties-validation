let API = null;
let validationRules = null;

// ==========================================
// 1. OPPSTART: Koble til 3D-modellen
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("status-message");
    const btn = document.getElementById("btn-validate");
    
    try {
        statusEl.innerText = "Kobler til Trimble Connect...";
        // Etablerer sikker tilkobling umiddelbart
        API = await window.TrimbleConnectWorkspace.connect(window.parent);
        
        statusEl.innerText = "✅ Klar til validering!";
        statusEl.style.color = "green";
        
        btn.disabled = false;
        btn.innerText = "Valider valgte objekter";
        
        setTimeout(() => statusEl.classList.add("hidden"), 3000);
    } catch (e) {
        statusEl.innerText = "❌ Feil ved oppstart: " + e.message;
        statusEl.style.color = "red";
    }
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
        if (!API) throw new Error("API er ikke tilkoblet!");

        // --- DEL A: Hent JSON fra GitHub ---
        if (!validationRules) {
            btn.innerText = "Henter regler...";
            statusEl.innerText = "Laster ned regler fra GitHub...";
            statusEl.style.color = "blue";
            
            // Leter etter filen i samme mappe på GitHub
            const response = await fetch("0_Element.json");
            if (!response.ok) {
                throw new Error("Fant ikke 0_Element.json. Ligger den i samme mappe på GitHub?");
            }
            
            validationRules = await response.json();
            statusEl.innerText = "Regler lastet inn!";
            statusEl.style.color = "green";
        }

        // --- DEL B: Valider 3D-modellen ---
        btn.innerText = "Validerer objekter...";
        statusEl.innerText = "Sjekker objekter...";

        // Bruker det nye API-et til å hente markering (Test 1 var OK på denne)
        const selection = await API.selection.getSelection();
        if (!selection || selection.length === 0) {
            throw new Error("Marker et objekt i 3D-visningen først!");
        }

        // Vi bruker window.WorkspaceAPI som en reserveløsning for selve egenskapene, 
        // siden den fungerer smertefritt når vi først har markeringen.
        const objectsData = await window.WorkspaceAPI.objects.getObjects(selection);
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
                window.WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 255, g: 0, b: 0, a: 255 } }]);
            } else {
                window.WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 0, g: 255, b: 0, a: 255 } }]);
            }
        });

        resultsContainer.classList.remove("hidden");
        statusEl.classList.add("hidden");
        
        if (totalErrors === 0) {
            const li = document.createElement("li");
            li.className = "success";
            li.innerText = "Suksess! Alle valgte objekter følger reglene.";
            resultsList.appendChild(li);
        }

    } catch (error) {
        statusEl.innerText = "FEIL: " + error.message;
        statusEl.style.color = "red";
        console.error(error);
    } finally {
        resetBtn(btn);
    }
});

// ==========================================
// 3. HJELPEFUNKSJONER
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
