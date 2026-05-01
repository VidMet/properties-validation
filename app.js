// Initialiser Trimble Connect API
const WorkspaceAPI = window.WorkspaceAPI;

let validationRules = null;

// ==========================================
// 1. OPPSTART: Hent regler fra Trimble Connect
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("status-message");
    try {
        statusEl.classList.remove("hidden");
        statusEl.innerText = "Kobler til Trimble Connect for å hente regler...";
        
        // Spør Trimble om lov og finn ut hvilket prosjekt vi er i
        const project = await WorkspaceAPI.project.getProject();
        const token = await WorkspaceAPI.extension.getPermission('accesstoken');
        
        // Søk etter filen i prosjektet
        const tcApiUrl = `https://${project.region}.connect.trimble.com/tc/api/2.0/projects/${project.id}/files?name=0_Element.json`;
        
        const searchResponse = await fetch(tcApiUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!searchResponse.ok) throw new Error(`Klarte ikke søke i prosjektet (Status: ${searchResponse.status})`);

        const searchResult = await searchResponse.json();

        if (!searchResult || searchResult.length === 0) {
            throw new Error("Fant ikke filen '0_Element.json' i prosjektet. Er du sikker på at den er lastet opp?");
        }

        // Hent den nyeste versjonen av filen
        const fileId = searchResult[0].id;
        statusEl.innerText = "Laster ned 0_Element.json...";

        const fileContentUrl = `https://${project.region}.connect.trimble.com/tc/api/2.0/files/${fileId}/content`;
        const fileResponse = await fetch(fileContentUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!fileResponse.ok) throw new Error("Fant filen, men fikk ikke tilgang til å lese innholdet.");

        // Les filen og lagre reglene i minnet
        validationRules = await fileResponse.json();
        
        statusEl.innerText = "Regler lastet inn fra TC! Klar til validering.";
        statusEl.style.color = "green";
        setTimeout(() => statusEl.classList.add("hidden"), 4000);
        
    } catch (error) {
        statusEl.innerText = "Feil: " + error.message;
        statusEl.style.color = "red";
        console.error("Oppstartsfeil mot TC API:", error);
    }
});


// ==========================================
// 2. BRUKER-INTERAKSJON: Valider-knappen
// ==========================================
document.getElementById("btn-validate").addEventListener("click", async () => {
    if (!validationRules) return alert("Reglene er ikke lastet inn. Vent litt eller sjekk feilmeldingen øverst.");

    const btn = document.getElementById("btn-validate");
    const resultsList = document.getElementById("results-list");
    const resultsContainer = document.getElementById("results-container");
    
    btn.disabled = true;
    btn.innerText = "Validerer...";
    resultsList.innerHTML = ""; // Tømmer gamle resultater

    try {
        // Hent markerte objekter fra 3D-modellen
        const selection = await WorkspaceAPI.selection.getSelection();
        
        if (selection.length === 0) {
            alert("Du må markere minst ett objekt i 3D-modellen for å validere.");
            resetBtn(btn);
            return;
        }

        // Hent egenskapene (properties) til de markerte objektene
        const objectsData = await WorkspaceAPI.objects.getObjects(selection);
        
        let totalErrors = 0;

        // Gå gjennom hvert enkelt objekt
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
                
                // Farg objektet RØDT
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 255, g: 0, b: 0, a: 255 } }]);
            } else {
                // Farg objektet GRØNT
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 0, g: 255, b: 0, a: 255 } }]);
            }
        });

        resultsContainer.classList.remove("hidden");
        
        if (totalErrors === 0) {
            const li = document.createElement("li");
            li.className = "success";
            li.innerText = "Suksess! Alle valgte objekter følger reglene for 0_Element perfekt.";
            resultsList.appendChild(li);
        }

    } catch (error) {
        console.error("Feil ved validering mot TC:", error);
        alert("Klarte ikke å snakke med Trimble Connect. Sjekk konsollen (F12).");
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

// Gjør om Trimble sitt avanserte egenskaps-format til en enkel liste vi kan lese
function flattenProperties(tcProps) {
    let flat = {};
    if (!tcProps) return flat;
    tcProps.forEach(propSet => {
        propSet.properties.forEach(p => {
            flat[p.name] = p.value;
        });
    });
    return flat;
}


// ==========================================
// 4. HJERNEN: Selve Valideringsmotoren
// ==========================================
function runValidation(objProps, rules) {
    let errors = [];
    const fag = objProps["Underdisiplinkode"];

    for (const [propName, rule] of Object.entries(rules)) {
        const val = objProps[propName];

        // A) Sjekk Requirement (Påkrevd)
        if (rule.requirement === "required" && (!val || val.toString().trim() === "")) {
            errors.push(`Mangler påkrevd egenskap: <b>${propName}</b>`);
            continue; 
        }

        // Hopp over resten av sjekkene for denne egenskapen hvis den er valgfri og tom
        if (!val) continue; 

        // B) Sjekk Format (Regex / Dato / Tall)
        if (rule.format) {
            const regex = new RegExp(rule.format);
            if (!regex.test(val)) {
                errors.push(`Feil format på <b>${propName}</b>. Angitt verdi var: '${val}'`);
            }
        }

        // C) Sjekk Tillatte Verdier og Avhengigheter
        if (rule.allowedValues) {
            if (Array.isArray(rule.allowedValues)) {
                // Enkel liste (f.eks. for Underdisiplin)
                if (!rule.allowedValues.includes(val)) {
                    errors.push(`Ugyldig verdi for <b>${propName}</b>: '${val}'`);
                }
            } else if (typeof rule.allowedValues === 'object' && fag) {
                // Avansert nøstet logikk (Fag -> Klasse -> Type)
                
                if (propName === "Objektklasse") {
                    const lovligeKlasser = rule.allowedValues[fag];
                    if (!lovligeKlasser || !lovligeKlasser.includes(val)) {
                        errors.push(`Objektklassen '${val}' er ikke tillatt for faget '${fag}'`);
                    }
                } 
                else if (propName === "Objekttype") {
                    const klasse = objProps["Objektklasse"];
                    const lovligeKlasser = rule.allowedValues[fag];
                    
                    if (lovligeKlasser && lovligeKlasser[klasse]) {
                        const lovligeTyper = lovligeKlasser[klasse];
                        if (!lovligeTyper.includes(val)) {
                            errors.push(`Typen '${val}' er ikke tillatt for klassen '${klasse}' i faget '${fag}'`);
                        }
                    } else {
                         errors.push(`Kan ikke validere Objekttype fordi klassen '${klasse}' er ugyldig for '${fag}'.`);
                    }
                }
            }
        }
    }
    return errors;
}
