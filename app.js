const WorkspaceAPI = window.WorkspaceAPI;

document.addEventListener("DOMContentLoaded", () => {
    const statusEl = document.getElementById("status-message");
    statusEl.classList.remove("hidden");
    statusEl.innerText = "Klar for systemtest!";
    statusEl.style.color = "blue";
});

document.getElementById("btn-validate").addEventListener("click", async () => {
    const statusEl = document.getElementById("status-message");
    const btn = document.getElementById("btn-validate");
    btn.disabled = true;
    
    try {
        statusEl.innerText = "Test 1: Sjekker 3D-modellen...";
        statusEl.style.color = "black";
        
        const selection = await WorkspaceAPI.selection.getSelection();
        if (selection.length === 0) {
            throw new Error("Du må markere et objekt i modellen for å kjøre testen!");
        }
        statusEl.innerText = "✅ Test 1 OK: Fant " + selection.length + " markert(e) objekt(er)!";
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        statusEl.innerText = "Test 2: Spør om prosjekt-ID...";
        const project = await WorkspaceAPI.project.getProject();
        statusEl.innerText = "✅ Test 2 OK: Prosjekt-ID hentet!";
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        statusEl.innerText = "Test 3: Ber om Access Token...";
        const token = await WorkspaceAPI.extension.getPermission('accesstoken');
        statusEl.innerText = "✅ Test 3 OK: Alt fungerer! Vi har Token.";
        statusEl.style.color = "green";

    } catch (error) {
        statusEl.innerText = "❌ KRASJ! " + error.message;
        statusEl.style.color = "red";
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerText = "Kjør test på nytt";
    }
});
