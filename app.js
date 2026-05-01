// Initialiser Trimble Connect API
const WorkspaceAPI = window.WorkspaceAPI;

// Vi bruker GitHub-URLen inntil vi vet at motoren virker 100%.
// Når vi flytter til TC senere, bytter vi ut denne linjen med TC sin autorisasjons-kode.
const RULES_URL = "0_Element.json"; 

let validationRules = null;

// Når siden lastes, prøv å hente JSON-reglene
document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("status-message");
    try {
        statusEl.classList.remove("hidden");
        statusEl.innerText = "Laster regelverk...";
        
        // 1. Hent filen
        const response = await fetch(RULES_URL);
        
        // Sjekk om filen i det hele tatt finnes (404 Not Found)
        if (!response.ok) {
            throw new Error(`Finner ikke 0_Element.json (HTTP Status: ${response.status}). Sjekk at filen ligger i samme mappe på GitHub.`);
        }
        
        // 2. Prøv å lese den som JSON
        try {
            validationRules = await response.json();
        } catch (jsonError) {
            throw new Error("Skrivefeil i 0_Element.json. Åpne jsonlint.com for å finne det manglende kommaet eller parentesen.");
        }
        
        statusEl.innerText = "Regler lastet inn! Klar til validering.";
        statusEl.style.color = "green";
        setTimeout(() => statusEl.classList.add("hidden"), 3000);
        
    } catch (error) {
        statusEl.innerText = "Feil: " + error.message;
        statusEl.style.color = "red";
        console.error("Oppstartsfeil:", error);
    }
});

// Lytt etter klikk på "Valider"-knappen
document.getElementById("btn-validate").addEventListener("click", async () => {
    if (!validationRules) return alert("Reglene er ikke lastet inn. Sjekk feilmeldingen øverst.");

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
            alert("Du må markere minst ett objekt i 3D-modellen for å validere.");
            resetBtn(btn);
            return;
        }

        // 2. Hent egenskapene for de valgte objektene fra Trimble Connect
        const objectsData = await WorkspaceAPI.objects.getObjects(selection);
        
        let totalErrors = 0;

        // 3. Gå gjennom hvert enkelt objekt og valider
        objectsData.forEach(obj => {
            // Konverter TC-egenskaper til et enklere "flat" format
            const props = flattenProperties(obj.properties);
            
            // Kjør logikken
            const errors = runValidation(props, validationRules.properties);

            if (errors.length > 0) {
                totalErrors += errors.length;
                errors.forEach(err => {
                    const li = document.createElement("li");
                    // Viser en kort versjon av objektets ID
                    li.innerHTML = `<strong>Objekt: ${obj.id.substring(0,8)}...</strong><br>${err}`;
                    resultsList.appendChild(li);
                });
                
                // Farg objektet RØDT i 3D-modellen hvis det har feil
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 255, g: 0, b: 0, a: 255 } }]);
            } else {
                // Farg objektet GRØNT i 3D-modellen hvis alt er OK
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
        alert("Klarte ikke å snakke med Trimble Connect. Sjekk konsollen (F12) for detaljer.");
    } finally {
        resetBtn(btn);
    }
});

// Hjelpefunksjon for å resette knappen
function resetBtn(btn) {
    btn.disabled = false;
    btn.innerText = "Valider valgte objekter";
}

// Hjelpefunksjon for å hente ut verdiene fra Trimble Connects komplekse datastruktur
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

// Selve Valideringsmotoren (Den som leser reglene og sammenligner med objektet)
function runValidation(objProps, rules) {
    let errors = [];
    const fag = objProps["Underdisiplinkode"];

    for (const [propName, rule] of Object.entries(rules)) {
        const val = objProps[propName];

        // 1. Sjekk Requirement (Er egenskapen påkrevd?)
        if (rule.requirement === "required" && (!val || val.trim() === "")) {
            errors.push(`Mangler påkrevd egenskap: <b>${propName}</b>`);
            continue; 
        }

        // Hvis den er valgfri og ikke fylt ut, trenger vi ikke sjekke formater
        if (!val) continue; 

        // 2. Sjekk Format (F.eks. Regex for Revisjon eller Objektkode)
        if (rule.format) {
            const regex = new RegExp(rule.format);
            if (!regex.test(val)) {
                errors.push(`Feil format på <b>${propName}</b>. Angitt verdi var: '${val}'`);
            }
        }

        // 3. Sjekk Allowed Values (Fagspesifikk og Nøstet logikk)
        if (rule.allowedValues) {
            if (Array.isArray(rule.allowedValues)) {
                // Enkel liste-sjekk (f.eks. for Underdisiplin, der alle fag har samme liste)
                if (!rule.allowedValues.includes(val)) {
                    errors.push(`Ugyldig verdi for <b>${propName}</b>: '${val}'`);
                }
            } else if (typeof rule.allowedValues === 'object' && fag) {
                // Avansert sjekk for Objektklasse og Objekttype
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
                         errors.push(`Kan ikke validere Objekttype fordi klassen '${klasse}' er ugyldig for '${fag}'.`);
                    }
                }
            }
        }
    }
    return errors;
}
