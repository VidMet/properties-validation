const WorkspaceAPI = window.WorkspaceAPI;
let validationRules = null;

// ==========================================
// 1. OPPSTART
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    const statusEl = document.getElementById("status-message");
    statusEl.classList.remove("hidden");
    statusEl.innerText = "Klar! Trykk for å starte validering.";
    statusEl.style.color = "green";
});

// ==========================================
// 2. HOVEDFUNKSJON: VALIDER-KNAPPEN
// ==========================================
document.getElementById("btn-validate").addEventListener("click", async () => {
    const btn = document.getElementById("btn-validate");
    const statusEl = document.getElementById("status-message");
    const resultsList = document.getElementById("results-list");
    const resultsContainer = document.getElementById("results-container");
    
    btn.disabled = true;
    resultsList.innerHTML = "";
    statusEl.classList.remove("hidden");

    try {
        // --- STEG A: HENT TILGANG OG FIL FRA TRIMBLE CONNECT ---
        if (!validationRules) {
            btn.innerText = "Kobler til TC...";
            statusEl.innerText = "Henter sikkerhetsnøkkel fra Trimble...";
            statusEl.style.color = "blue";

            const project = await WorkspaceAPI.project.getProject();
            
            // Vi prøver å hente token. Hvis dette timer ut, er det ofte 
            // fordi nettleseren blokkerer forespørselen.
            const token = await WorkspaceAPI.extension.getPermission('accesstoken');
            
            statusEl.innerText = "Søker etter 0_Element.json i prosjektet...";
            
            // Vi søker etter filen i hele prosjektet. 
            const tcApiUrl = `https://${project.region}.connect.trimble.com/tc/api/2.0/projects/${project.id}/files?name=0_Element.json`;
            
            const searchResponse = await fetch(tcApiUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!searchResponse.ok) throw new Error("Kunne ikke søke i TC-filer.");

            const searchResult = await searchResponse.json();

            // Sjekk om filen faktisk ble funnet
            if (!searchResult || searchResult.length === 0) {
                throw new Error("Fant ikke '0_Element.json'. Ligger den i Trimble Connect?");
            }

            // Finn den nyeste versjonen og last den ned
            const fileId = searchResult[0].id;
            statusEl.innerText = "Laster ned reglene...";
            
            const fileContentUrl = `https://${project.region}.connect.trimble.com/tc/api/2.0/files/${fileId}/content`;
            const fileResponse = await fetch(fileContentUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            validationRules = await fileResponse.json();
            statusEl.innerText = "Regler hentet fra TC!";
            statusEl.style.color = "green";
        }

        // --- STEG B: UTFØR VALIDERBING ---
        btn.innerText = "Validerer...";
        const selection = await WorkspaceAPI.selection.getSelection();
        
        if (!selection || selection.length === 0) {
            throw new Error("Marker et objekt i 3D-visningen først!");
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
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 255, g: 0, b: 0, a: 255 } }]);
            } else {
                WorkspaceAPI.viewer.setColors([{ objects: [obj.id], color: { r: 0, g: 255, b: 0, a: 255 } }]);
            }
        });

        resultsContainer.classList.remove("hidden");
        statusEl.classList.add("hidden");
        
        if (totalErrors === 0) {
            const li = document.createElement("li");
            li.className = "success";
            li.innerText = "Suksess! Objektene følger reglene.";
            resultsList.appendChild(li);
        }

    } catch (error) {
        statusEl.innerText = "FEIL: " + error.message;
        statusEl.style.color = "red";
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerText = "Valider valgte objekter";
    }
});

// --- HJELPEFUNKSJONER ---
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
        let req = rule.requirement || rule.defaultRequirement;
        if (rule.overrides) {
            const ovr = rule.overrides.find(o => o.discipline === fag);
            if (ovr) req = ovr.requirement;
        }
        if (req === "required" && (!val || val.toString().trim() === "")) {
            errors.push(`Mangler: <b>${propName}</b>`);
            continue;
        }
        if (!val) continue;
        if (rule.format && !(new RegExp(rule.format).test(val))) {
            errors.push(`Formatfeil på <b>${propName}</b>: '${val}'`);
        }
        if (rule.allowedValues) {
            if (Array.isArray(rule.allowedValues)) {
                if (!rule.allowedValues.includes(val)) errors.push(`Ugyldig verdi: '${val}'`);
            } else if (typeof rule.allowedValues === 'object' && fag) {
                if (propName === "Objektklasse") {
                    if (!rule.allowedValues[fag]?.includes(val)) errors.push(`Klasse '${val}' ugyldig for fag '${fag}'`);
                } else if (propName === "Objekttype") {
                    const kl = objProps["Objektklasse"];
                    if (!rule.allowedValues[fag]?.[kl]?.includes(val)) errors.push(`Type '${val}' ugyldig for klasse '${kl}'`);
                }
            }
        }
    }
    return errors;
}
