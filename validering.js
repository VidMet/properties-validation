let API = null;

// 1. UMIDDELBAR HÅNDHILSING (Forhindrer Timeout!)
document.addEventListener("DOMContentLoaded", async () => {
    const statusEl = document.getElementById("status-message");
    const btn = document.getElementById("btn-validate");
    
    try {
        statusEl.innerText = "Håndhilser med Trimble...";
        
        // Kobler til Trimble Connect med en gang!
        API = await window.TrimbleConnectWorkspace.connect(window.parent);
        
        statusEl.innerText = "✅ API Tilkoblet! Klar for test.";
        statusEl.style.color = "green";
        
        // Skru på knappen
        btn.disabled = false;
        btn.innerText = "Kjør systemtest";
    } catch (e) {
        statusEl.innerText = "❌ Feil ved tilkobling: " + e.message;
        statusEl.style.color = "red";
    }
});

// 2. KJØR TESTENE NÅR DU KLIKKER
document.getElementById("btn-validate").addEventListener("click", async () => {
    const statusEl = document.getElementById("status-message");
    const btn = document.getElementById("btn-validate");
    btn.disabled = true;

    if (!API) {
        statusEl.innerText = "❌ API er ikke tilkoblet!";
        return;
    }

    try {
        statusEl.innerText = "Test 1: Sjekker markering...";
        statusEl.style.color = "black";
        
        const selection = await API.selection.getSelection();
        if (selection.length === 0) throw new Error("Marker et objekt først!");
        
        statusEl.innerText = `✅ Test 1 OK (${selection.length} objekt valgt)`;
        await new Promise(r => setTimeout(r, 1500)); // Vent litt så du rekker å lese

        statusEl.innerText = "Test 2: Henter prosjekt...";
        const project = await API.project.getProject();
        statusEl.innerText = `✅ Test 2 OK (Prosjekt-ID hentet)`;
        await new Promise(r => setTimeout(r, 1500));

        statusEl.innerText = "Test 3: Henter Access Token...";
        const token = await API.extension.getPermission('accesstoken');
        statusEl.innerText = "✅ Test 3 OK! Alt fungerer perfekt.";
        statusEl.style.color = "green";

    } catch (error) {
        statusEl.innerText = "❌ KRASJ: " + error.message;
        statusEl.style.color = "red";
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerText = "Prøv igjen";
    }
});
