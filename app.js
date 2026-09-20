// ==========================================
// CONFIGURACIÓN DE TU RED
// ==========================================
const CONFIG = {
    engineAccount: "0x4e4542e3.c.aurora",
    chainId: 1313161955,
    tokens: {
        USDT: {
            nearContract: "usdt.tether-token.near",
            evmContract: "0x80da25da4d783e57d2fcda0436873a193a4beccf",
            decimals: 6 // USDT usa 6 decimales en ambas redes
        }
    }
};

// Variables globales
let nearWallet = null;
let evmSigner = null;
let nearAccountId = null;
let evmAddress = null;

// ==========================================
// 1. CONEXIÓN DE BILLETERAS
// ==========================================
async function initNear() {
    const { connect, keyStores, WalletConnection } = window.nearApi;
    const nearConfig = {
        networkId: "mainnet",
        nodeUrl: "https://rpc.mainnet.near.org",
        walletUrl: "https://app.mynearwallet.com",
        helperUrl: "https://helper.mainnet.near.org",
        keyStore: new keyStores.BrowserLocalStorageKeyStore()
    };
    const near = await connect(nearConfig);
    nearWallet = new WalletConnection(near, "PuenteVirtualChain");
    
    if (nearWallet.isSignedIn()) {
        nearAccountId = nearWallet.getAccountId();
        updateStatus();
    }
}
window.onload = initNear; // Inicializa NEAR al cargar la página

function connectNear() {
    if (!nearWallet.isSignedIn()) {
        nearWallet.requestSignIn(CONFIG.tokens.USDT.nearContract, "Puente a Virtual Chain");
    } else {
        nearWallet.signOut();
        nearAccountId = null;
        updateStatus();
    }
}

async function connectEVM() {
    if (window.ethereum) {
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            await provider.send("eth_requestAccounts", []);
            evmSigner = await provider.getSigner();
            evmAddress = await evmSigner.getAddress();
            
            // Sugerir cambio a tu Virtual Chain si no está en ella
            const currentChain = await provider.getNetwork();
            if(Number(currentChain.chainId) !== CONFIG.chainId) {
                alert("Por favor, cambia a la red de tu Virtual Chain en MetaMask");
            }
            updateStatus();
        } catch (error) {
            console.error(error);
            alert("Error conectando MetaMask");
        }
    } else {
        alert("Abre esta página desde el navegador integrado de MetaMask o TrustWallet");
    }
}

function updateStatus() {
    const statusBox = document.getElementById("status");
    let text = "";
    text += nearAccountId ? `NEAR: ${nearAccountId}<br>` : "NEAR: Desconectado<br>";
    text += evmAddress ? `EVM: ${evmAddress}` : "EVM: Desconectado";
    statusBox.innerHTML = text;
    
    document.getElementById("btn-near").innerText = nearAccountId ? "Desconectar NEAR" : "Conectar NEAR";
}

// ==========================================
// 2. LÓGICA DEL PUENTE (DEPÓSITO Y RETIRO)
// ==========================================

async function depositToVirtualChain() {
    if (!nearAccountId || !evmAddress) return alert("Conecta ambas billeteras primero");
    
    const amountInput = document.getElementById("amount").value;
    if (!amountInput || amountInput <= 0) return alert("Ingresa una cantidad válida");

    try {
        document.getElementById("bridge-msg").innerText = "Redirigiendo a NEAR para aprobar...";
        
        // Convertir la cantidad a los decimales de USDT (6 ceros)
        const amountConDecimales = (parseFloat(amountInput) * Math.pow(10, 6)).toString();

        // Enviar la transacción al contrato de USDT en NEAR
        await nearWallet.account().functionCall({
            contractId: CONFIG.tokens.USDT.nearContract,
            methodName: "ft_transfer_call",
            args: {
                receiver_id: CONFIG.engineAccount, // Envía a tu cadena
                amount: amountConDecimales,
                msg: evmAddress // El motor lee este msj y acuña a esta dirección EVM
            },
            gas: "300000000000000", // 300 TGas
            attachedDeposit: "1" // Requiere 1 yoctoNEAR por seguridad
        });
        
    } catch (error) {
        console.error(error);
        alert("Error en el depósito");
    }
}

async function withdrawToNear() {
    if (!nearAccountId || !evmAddress) return alert("Conecta ambas billeteras primero");
    
    const amountInput = document.getElementById("amount").value;
    if (!amountInput || amountInput <= 0) return alert("Ingresa una cantidad válida");

    try {
        document.getElementById("bridge-msg").innerText = "Abre MetaMask para firmar...";
        
        // El ABI estándar que utiliza Aurora Engine para retiros
        const abi = ["function withdraw(string memory receiver_id, uint256 amount) public"];
        const tokenContract = new ethers.Contract(CONFIG.tokens.USDT.evmContract, abi, evmSigner);
        
        const amountWei = ethers.parseUnits(amountInput, 6); // 6 decimales para USDT

        // Ejecutar el retiro hacia la cuenta NEAR
        const tx = await tokenContract.withdraw(nearAccountId, amountWei);
        document.getElementById("bridge-msg").innerText = "Transacción enviada. Esperando confirmación...";
        
        await tx.wait();
        document.getElementById("bridge-msg").innerText = "¡Retiro exitoso a NEAR!";
    } catch (error) {
        console.error(error);
        alert("Error en el retiro: Revisa si tienes gas suficiente en tu red.");
        document.getElementById("bridge-msg").innerText = "";
    }
}

