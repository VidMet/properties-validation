// Globale variabler
let WorkspaceAPI;
let validationRules = null;

// ==========================================
// 1. OPPSTART: Koble til TC og hent regler
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("status-message");
    try {
        statusEl.classList.remove("hidden");
        statusEl.innerText = "Oppretter forbindelse til Trimble Connect...";

        // Initialiserer forbindelsen til 3D-vieweren
        WorkspaceAPI = await window.TrimbleConnectWorkspace.connect(window.parent);
        
        statusEl.innerText = "Forbundet! Henter prosjektdata...";

        // Henter nødvendig info for å bruke Trimbles API
        const project = await WorkspaceAPI.project.getProject();
        const token = await WorkspaceAPI.extension.getPermission('accesstoken');

        // Søker etter filen i hele prosjektet (uavhengig av mappe)
        statusEl.innerText = "Søker etter 0_Element.json...";
        const tcApiUrl = `https://${project.region}.connect.trimble.com/tc/api/2.0/projects/${project.id}/files?name=0_Element.json`;
        
        const searchResponse = await fetch(tcApiUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!searchResponse.ok) throw new Error("Kunne ikke søke i prosjektet.");

        const searchResult = await searchResponse.json();

        if (!searchResult || searchResult.length === 0) {
            throw new Error("Fant ikke '0_Element.json' i prosjektet. Sjekk filnavnet.");
        }

        // Henter innholdet i den første filen som ble funnet
        const fileId = searchResult[0].id;
        statusEl.innerText = "Laster ned valideringsregler...";
        
        const fileContentUrl = `https://${project.region}.connect.trimble.com/tc/api/2.0/files/${fileId}/content`;
        const fileResponse = await fetch(fileContentUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!fileResponse.ok) throw new Error("Kunne ikke lese filinnholdet.");

        validationRules = await fileResponse.json();
        
        statusEl.innerText = "Regler lastet inn! Klar til validering.";
        statusEl.style.color = "green";
        setTimeout(() => statusEl.classList.add("hidden"), 3000);

    } catch (error) {
        statusEl.innerText = "Feil: " + error.message;
        statusEl.style.color = "red";
        console.error("Initialiseringsfeil:", error);
    }
});

// ==========================================
// 2. BRUKERHANDLING: Valider-knappen
// ==========================================
document.getElementById("btn-validate").addEventListener("click", async () => {
    if (!validationRules) return alert("Reglene er ikke lastet inn ennå.");

    const btn = document.getElementById("btn-validate");
    const resultsList = document.getElementById("results-list");
    const resultsContainer = document.getElementById("results-container");
    
    btn.disabled = true;
    btn.innerText = "Validerer...";
    resultsList.innerHTML = ""; 

    try {
        const selection = await WorkspaceAPI.selection.getSelection();
        
        if (selection.length === 0) {
            alert("Vennligst velg ett eller flere objekter i modellen.");
            resetBtn(btn);
            return;
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
                // Farger objektet RØDT i 3D-visning
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 255, g: 0, b: 0, a: 255 } }]);
            } else {
                // Farger objektet GRØNT hvis alt er OK
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 0, g: 255, b: 0, a: 255 } }]);
            }
        });

        resultsContainer.classList.remove("hidden");
        
        if (totalErrors === 0) {
            const li = document.createElement("li");
            li.className = "success";
            li.innerText = "Alt i orden! Objektene følger reglene.";
            resultsList.appendChild(li);
        }

    } catch (error) {
        console.error("Valideringsfeil:", error);
        alert("En feil oppstod under valideringen.");
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

// Gjør om Trimbles datastruktur til en enkel "nøkkel-verdi"-liste
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

// Selve valideringslogikken
function runValidation(objProps, rules) {
    let errors = [];
    const fag = objProps["Underdisiplinkode"];

    for (const [propName, rule] of Object.entries(rules)) {
        const val = objProps[propName];

        // 1. Sjekk påkrevd status (inkludert fag-spesifikke overrides som Bruksstatus)
        let effectiveRequirement = rule.requirement || rule.defaultRequirement;
        if (rule.overrides) {
            const override = rule.overrides.find(o => o.discipline === fag);
            if (override) effectiveRequirement = override.requirement;
        }

        if (effectiveRequirement === "required" && (!val || val.toString().trim() === "")) {
            errors.push(`Mangler påkrevd egenskap: <b>${propName}</b>`);
            continue;
        }

        // Hvis feltet er tomt og ikke påkrevd, hopper vi over resten av sjekkene
        if (!val) continue;

        // 2. Format-sjekk (Regex) - f.eks. Dato eller Objektkode
        if (rule.format) {
            const regex = new RegExp(rule.format);
            if (!regex.test(val)) {
                errors.push(`Feil format på <b>${propName}</b>. Verdi: '${val}'`);
            }
        }

        // 3. Tillatte verdier (Enkel liste eller fag-nøstet logikk)
        if (rule.allowedValues) {
            if (Array.isArray(rule.allowedValues)) {
                // Enkel liste (f.eks. Underdisiplin)
                if (!rule.allowedValues.includes(val)) {
                    errors.push(`Ugyldig verdi for <b>${propName}</b>: '${val}'`);
                }
            } else if (typeof rule.allowedValues === 'object' && fag) {
                // Fag-spesifikk logikk (Objektklasse og Objekttype)
                
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
