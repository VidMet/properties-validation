// Initialiser Trimble Connect API
const WorkspaceAPI = window.WorkspaceAPI;

// Midlertidig URL til der du hoster din 0_Element.json (f.eks. på GitHub)
// Senere kan vi koble denne rett mot Trimble Connect mappen din.
const RULES_URL = "0_Element.json"; 

let validationRules = null;

// Når siden lastes, hent reglene
document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("status-message");
    try {
        statusEl.classList.remove("hidden");
        statusEl.innerText = "Laster regelverk...";
        
        // Henter JSON-filen
        const response = await fetch(RULES_URL);
        validationRules = await response.json();
        
        statusEl.innerText = "Regler lastet. Klar til validering!";
        setTimeout(() => statusEl.classList.add("hidden"), 2000);
    } catch (error) {
        statusEl.innerText = "Feil ved lasting av regler. Sjekk filbanen.";
        statusEl.style.color = "red";
        console.error(error);
    }
});

// Lytt etter klikk på "Valider"-knappen
document.getElementById("btn-validate").addEventListener("click", async () => {
    if (!validationRules) return alert("Reglene er ikke lastet inn ennå.");

    const btn = document.getElementById("btn-validate");
    const resultsList = document.getElementById("results-list");
    const resultsContainer = document.getElementById("results-container");
    
    btn.disabled = true;
    btn.innerText = "Validerer...";
    resultsList.innerHTML = ""; // Tøm gamle resultater

    try {
        // 1. Spør Trimble Connect hvilke objekter brukeren har markert
        const selection = await WorkspaceAPI.selection.getSelection();
        
        if (selection.length === 0) {
            alert("Du må markere minst ett objekt i 3D-modellen.");
            resetBtn(btn);
            return;
        }

        // 2. Hent egenskapene for de valgte objektene
        const objectsData = await WorkspaceAPI.objects.getObjects(selection);
        
        let totalErrors = 0;

        // 3. Valider hvert objekt
        objectsData.forEach(obj => {
            // Konverter Trimble sine egenskaper til et enklere key-value format
            const props = flattenProperties(obj.properties);
            const errors = runValidation(props, validationRules.properties);

            if (errors.length > 0) {
                totalErrors += errors.length;
                errors.forEach(err => {
                    const li = document.createElement("li");
                    li.innerHTML = `<strong>Objekt GUID: ${obj.id.substring(0,8)}...</strong><br>${err}`;
                    resultsList.appendChild(li);
                });
                
                // Bonus: Farg objektet rødt i 3D-modellen!
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 255, g: 0, b: 0, a: 255 } }]);
            } else {
                // Farg objektet grønt hvis alt er OK
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 0, g: 255, b: 0, a: 255 } }]);
            }
        });

        resultsContainer.classList.remove("hidden");
        
        if (totalErrors === 0) {
            const li = document.createElement("li");
            li.className = "success";
            li.innerText = "Suksess! Alle valgte objekter følger reglene for 0_Element.";
            resultsList.appendChild(li);
        }

    } catch (error) {
        console.error("Valideringsfeil:", error);
        alert("Det skjedde en feil under kommunikasjonen med Trimble Connect.");
    } finally {
        resetBtn(btn);
    }
});

// Hjelpefunksjon for å resette knappen
function resetBtn(btn) {
    btn.disabled = false;
    btn.innerText = "Valider valgte objekter";
}

// Hjelpefunksjon for å gjøre Trimble sine properties lettere å lese i koden
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

// Selve Regel-Motoren
function runValidation(objProps, rules) {
    let errors = [];
    const fag = objProps["Underdisiplinkode"];

    for (const [propName, rule] of Object.entries(rules)) {
        const val = objProps[propName];

        // 1. Sjekk Requirement (Påkrevd)
        if (rule.requirement === "required" && (!val || val.trim() === "")) {
            errors.push(`Mangler påkrevd egenskap: <b>${propName}</b>`);
            continue; 
        }

        if (!val) continue; // Hvis den er valgfri og ikke fylt ut, hopp til neste

        // 2. Sjekk Format (Regex / Dato / 8 Siffer)
        if (rule.format) {
            const regex = new RegExp(rule.format);
            if (!regex.test(val)) {
                errors.push(`Feil format på <b>${propName}</b>. Angitt verdi var: '${val}'`);
            }
        }

        // 3. Sjekk Allowed Values (Fagspesifikk og Nøstet logikk)
        if (rule.allowedValues) {
            if (Array.isArray(rule.allowedValues)) {
                // Enkel liste-sjekk (f.eks. for Underdisiplin)
                if (!rule.allowedValues.includes(val)) {
                    errors.push(`Ugyldig verdi for <b>${propName}</b>: '${val}'`);
                }
            } else if (typeof rule.allowedValues === 'object' && fag) {
                // Avansert sjekk (Klasse -> Type koblet mot Fag)
                if (propName === "Objektklasse") {
                    const lovligeKlasser = rule.allowedValues[fag];
                    if (!lovligeKlasser || !lovligeKlasser.includes(val)) {
                        errors.push(`Objektklassen '${val}' er ikke tillatt for faget '${fag}'`);
                    }
                } else if (propName === "Objekttype") {
                    const klasse = objProps["Objektklasse"];
                    const lovligeKlasser = rule.allowedValues[fag];
                    if (lovligeKlasser && lovligeKlasser[klasse]) {
                        const lovligeTyper = lovligeKlasser[klasse];
                        if (!lovligeTyper.includes(val)) {
                            errors.push(`Typen '${val}' er ikke tillatt for klassen '${klasse}' i faget '${fag}'`);
                        }
                    } else {
                         errors.push(`Kan ikke validere Objekttype fordi klassen '${klasse}' er ugyldig.`);
                    }
                }
            }
        }
    }
    return errors;
}
