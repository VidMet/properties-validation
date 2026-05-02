let API = null;
let validationRules = null;

// ==========================================
// 1. OPPSTART: Omgår CORS-blokkeringen
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("status-message");
    statusEl.classList.remove("hidden");
    statusEl.innerText = "Håndhilser med Trimble...";
    statusEl.style.color = "blue";
    
    try {
        // Det nye API-et åpner en sikker bro mellom GitHub og Trimble
        API = await window.TrimbleConnectWorkspace.connect(window.parent);
        
        statusEl.innerText = "✅ Klar til validering!";
        statusEl.style.color = "green";
        setTimeout(() => statusEl.classList.add("hidden"), 3000);
    } catch (e) {
        statusEl.innerText = "❌ Feil ved oppstart: " + e.message;
        statusEl.style.color = "red";
    }
});

// ==========================================
// 2. HOVEDFUNKSJON: VALIDER-KNAPPEN
// ==========================================
document.getElementById("btn-validate").addEventListener("click", async () => {
    const btn = document.getElementById("btn-validate");
    const resultsList = document.getElementById("results-list");
    const resultsContainer = document.getElementById("results-container");
    const statusEl = document.getElementById("status-message");
    
    if (!API) {
        alert("Trimble Connect API er ikke tilkoblet ennå! Vent noen sekunder.");
        return;
    }

    btn.disabled = true;
    resultsList.innerHTML = "";
    statusEl.classList.remove("hidden");

    try {
        // --- DEL A: HENT REGLER FRA TRIMBLE CONNECT ---
        if (!validationRules) {
            btn.innerText = "Kobler til prosjektet...";
            statusEl.innerText = "Henter prosjektinformasjon...";
            statusEl.style.color = "blue";

            const project = await API.project.getProject();
            
            statusEl.innerText = "Ber om sikkerhetsnøkkel for å lese fil...";
            // Henter Token. (NB: Hvis det timer ut her, sjekk om Trimble Connect 
            // har en innstilling eller varsel som ber deg "Godkjenne" utvidelsen)
            const token = await API.extension.getPermission('accesstoken');
            
            statusEl.innerText = "Leter etter 0_Element.json...";
            const tcApiUrl = `https://${project.region}.connect.trimble.com/tc/api/2.0/projects/${project.id}/files?name=0_Element.json`;
            
            const searchResponse = await fetch(tcApiUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!searchResponse.ok) throw new Error("Klarte ikke å søke etter filen i Trimble.");

            const searchResult = await searchResponse.json();

            if (!searchResult || searchResult.length === 0) {
                throw new Error("Fant ikke filen '0_Element.json' i prosjektet.");
            }

            statusEl.innerText = "Laster ned fil...";
            const fileId = searchResult[0].id;
            const fileContentUrl = `https://${project.region}.connect.trimble.com/tc/api/2.0/files/${fileId}/content`;
            
            const fileResponse = await fetch(fileContentUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!fileResponse.ok) throw new Error("Fikk ikke tilgang til innholdet i filen.");

            validationRules = await fileResponse.json();
            statusEl.innerText = "Regler hentet fra Trimble Connect!";
            statusEl.style.color = "green";
            
            // Liten pause så du rekker å se at nedlastingen var vellykket
            await new Promise(r => setTimeout(r, 1000));
        }

        // --- DEL B: VALIDER MODELLEN ---
        btn.innerText = "Validerer...";
        statusEl.innerText = "Leser 3D-modell...";

        // Bruker kommandoen som var vellykket i "Test 1"
        const selection = await API.selection.getSelection();
        const hasSelection = Array.isArray(selection) ? selection.length > 0 : (selection && Object.keys(selection).length > 0);
        
        if (!hasSelection) {
            throw new Error("Du må markere ett eller flere objekter i 3D-visningen først.");
        }

        const objectsData = await API.objects.getObjects(selection);
        let totalErrors = 0;

        // Tøm eventuelle tidligere farger før vi fargelegger på nytt
        await API.viewer.setColors([{ objects: [], color: { r: 255, g: 255, b: 255, a: 255 } }]);

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
                API.viewer.setColors([{ objects: [obj.id], color: { r: 255, g: 0, b: 0, a: 255 } }]);
            } else {
                API.viewer.setColors([{ objects: [obj.id], color: { r: 0, g: 255, b: 0, a: 255 } }]);
            }
        });

        resultsContainer.classList.remove("hidden");
        statusEl.classList.add("hidden");
        
        if (totalErrors === 0) {
            const li = document.createElement("li");
            li.className = "success";
            li.innerText = "Suksess! Alle valgte objekter følger reglene for 0_Element.";
            resultsList.appendChild(li);
        }

    } catch (error) {
        statusEl.innerText = "FEIL: " + error.message;
        statusEl.style.color = "red";
        console.error("Krasj:", error);
    } finally {
        resetBtn(btn);
    }
});

// --- HJELPEFUNKSJONER ---
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
        let req = rule.requirement || rule.defaultRequirement;
        if (rule.overrides) {
            const ovr = rule.overrides.find(o => o.discipline === fag);
            if (ovr) req = ovr.requirement;
        }
        if (req === "required" && (!val || val.toString().trim() === "")) {
            errors.push(`Mangler påkrevd egenskap: <b>${propName}</b>`);
            continue;
        }
        if (!val) continue;
        if (rule.format && !(new RegExp(rule.format).test(val))) {
            errors.push(`Formatfeil på <b>${propName}</b>. Verdi: '${val}'`);
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
