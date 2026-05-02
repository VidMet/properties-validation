let API = null;

// 1. HÅNDHILSING
document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("status-message");
    const btn = document.getElementById("btn-validate");
    
    try {
        statusEl.innerText = "Håndhilser med Trimble...";
        API = await window.TrimbleConnectWorkspace.connect(window.parent);
        
        statusEl.innerText = "✅ API Tilkoblet!";
        statusEl.style.color = "green";
        
        btn.disabled = false;
        btn.innerText = "Kjør røntgen på API";
    } catch (e) {
        statusEl.innerText = "❌ Feil: " + e.message;
        statusEl.style.color = "red";
    }
});

// 2. RØNTGEN-TESTEN
document.getElementById("btn-validate").addEventListener("click", () => {
    const statusEl = document.getElementById("status-message");
    const btn = document.getElementById("btn-validate");
    btn.disabled = true;

    try {
        if (!API) throw new Error("API er ikke tilkoblet!");

        // Henter ut alle overskrifter/mapper inne i API-et
        let tilgjengeligeMapper = [];
        for (let nøkkel in API) {
            tilgjengeligeMapper.push(nøkkel);
        }

        // Skriver det ut på skjermen
        statusEl.innerText = "Innhold i API: " + tilgjengeligeMapper.join(", ");
        statusEl.style.color = "blue";

    } catch (error) {
        statusEl.innerText = "❌ KRASJ: " + error.message;
        statusEl.style.color = "red";
    } finally {
        btn.disabled = false;
        btn.innerText = "Kjør på nytt";
    }
});
