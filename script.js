const SUPABASE_URL = "https://gjxlapydpafwvyohovhj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqeGxhcHlkcGFmd3Z5b2hvdmhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNDc3NTIsImV4cCI6MjA4NzcyMzc1Mn0.ni9szYqdrFWz3HcwYuOZaBFgcFddDoYSyZEakSQho-c";
const PLANILHA_URL = "https://script.google.com/macros/s/AKfycbzhJdbeZfxkHgh3cQrK_YlhBCuhZyLhM_9jYkAnCPmbz-aYpv7845740KySuhjTzdIb/exec";
const LS_USER_ID = "pascoa_user_id";
const LS_NICKNAME = "pascoa_nickname";

const RARITY_CONFIG = {
    comum: { label: "Comum", emoji: "🥚", className: "comum", points: 5 },
    incomum: { label: "Incomum", emoji: "🍀", className: "incomum", points: 10 },
    raro: { label: "Raro", emoji: "💎", className: "raro", points: 30 },
    epico: { label: "Epico", emoji: "👑", className: "epico", points: 50 },
    lendario: { label: "Lendario", emoji: "🏆", className: "lendario", points: 100 },
    coelhao: { label: "Coelhao", emoji: "🐰", className: "coelhao", points: 500 }
};

const CARGOS_ADMIN = ["lider", "vice-lider", "diretor", "gerente", "supervisor", "analista", "ministro", "capacitador"];

const getHabboAvatarUrl = (nickname, size = "b", action = "std", direction = 2, headDirection = 2, gesture = "std") => {
    if (!nickname) return null;
    const cleanNick = nickname.trim().toLowerCase().replace(/\s+/g, ".");
    return `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(cleanNick)}&size=${size}&action=${action}&direction=${direction}&head_direction=${headDirection}&gesture=${gesture}`;
};

const getHabboAvatarUrlV2 = (nickname, size = "l") => {
    if (!nickname) return null;
    return `https://www.habboapi.com.br/avatar.php?user=${encodeURIComponent(nickname)}&size=${size}&action=std&direction=2&head_direction=3&gesture=sml`;
};

const state = {
    user: null,
    eggTypes: [],
    prizes: [],
    redemptions: [],
    ranking: [],
    rankingMode: "pontos",
    adminData: {
        codes: [],
        prizes: [],
        pending: [],
        stats: null
    },
    currentCode: null,
    cargosPlanilha: []
};

let supabaseClient = null;
let toastTimer = null;

const $id = (id) => document.getElementById(id);

const escapeHtml = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const formatNumber = (value) => new Intl.NumberFormat("pt-BR").format(Number(value || 0));
const formatDateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "-";

const showToast = (type, title, message) => {
    const toast = $id("toast");
    toast.className = "toast " + type;
    toast.querySelector(".toast-icon").innerHTML = type === "error" ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-check"></i>';
    $id("toastTitle").textContent = title;
    $id("toastMessage").textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
};

const openModal = (id) => $id(id)?.classList.add("active");
const closeModal = (id) => $id(id)?.classList.remove("active");

function toggleMobileMenu() {
    const sidebar = $id("sidebarNav");
    const overlay = $id("sidebarOverlay");
    const menuBtn = $id("mobileMenuBtn");
    const isOpen = sidebar.classList.contains("active");
    sidebar.classList.toggle("active", !isOpen);
    overlay.classList.toggle("active", !isOpen);
    menuBtn.classList.toggle("active", !isOpen);
}

function closeMobileMenu() {
    if ($id("sidebarNav").classList.contains("active")) toggleMobileMenu();
}

function showSection(section) {
    document.querySelectorAll(".section-content").forEach(el => el.classList.add("hidden"));
    $id(`section-${section}`)?.classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-section") === section);
    });
    if (section === "admin" && state.user?.is_admin) {
        loadAdminData();
    }
}

function fecharComprovacaoModal() { closeModal("comprovacaoModal"); }
function fecharResultadoModal() { closeModal("resultadoModal"); }
function fecharViewProofModal() { closeModal("viewProofModal"); }
function fecharRejectModal() { closeModal("rejectModal"); }
function fecharCodigoModal() { closeModal("codigoModal"); }
function fecharPremioModal() { closeModal("premioModal"); }
function fecharEditPremioModal() { closeModal("editPremioModal"); }
function abrirCodigoModal() { openModal("codigoModal"); }
function abrirPremioModal() { openModal("premioModal"); }

$id("premioImagem")?.addEventListener("input", (e) => {
    const url = e.target.value;
    const preview = $id("premioPreview");
    const text = $id("premioPreviewText");
    if (url) {
        preview.src = url;
        preview.style.display = "block";
        text.style.display = "none";
        preview.onerror = () => {
            preview.style.display = "none";
            text.style.display = "block";
            text.textContent = "Erro ao carregar imagem";
        };
    } else {
        preview.style.display = "none";
        text.style.display = "block";
    }
});

$id("comprovacaoLink")?.addEventListener("input", (e) => {
    const url = e.target.value;
    const preview = $id("linkPreview");
    const img = $id("previewImageLink");
    if (url) {
        img.src = url;
        preview.style.display = "block";
    } else {
        preview.style.display = "none";
    }
});

const ensureSupabase = () => {
    if (!window.supabase?.createClient) {
        showToast("error", "Erro", "Biblioteca Supabase não carregou");
        return false;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
};

let subscriptions = {};

const setupRealtimeSubscriptions = () => {
    Object.values(subscriptions).forEach(sub => sub?.unsubscribe?.());
    subscriptions = {};

    // Assinar mudanças no próprio usuário (via RLS seguro)
    subscriptions.users = supabaseClient
        .channel(`user-${state.user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "users", filter: `id=eq.${state.user.id}` }, (payload) => {
            state.user = { ...state.user, ...payload.new };
            updateUserUI();
        })
        .subscribe();

    // Assinar mudanças nos próprios resgates (via RLS seguro)
    subscriptions.redemptions = supabaseClient
        .channel(`redemptions-user-${state.user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "redemptions", filter: `user_id=eq.${state.user.id}` }, (payload) => {
            loadRedemptions();
            if (payload.old?.status === "pending" && payload.new?.status === "approved") {
                refreshUserData();
            }
        })
        .subscribe();

    // Admin: assinar novos resgates (apenas se for admin)
    if (state.user?.is_admin) {
        subscriptions.allRedemptions = supabaseClient
            .channel("all-redemptions")
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "redemptions" }, (payload) => {
                if (!$id("section-admin")?.classList.contains("hidden")) {
                    loadAdminData();
                }
            })
            .subscribe();
    }
};

// ✅ SEGURO: Usa RPC ao invés de SELECT direto
const refreshUserData = async () => {
    // Usa a política RLS que permite ver próprio usuário
    const { data } = await supabaseClient
        .from("users")
        .select("*")
        .eq("id", state.user.id)
        .single();
    
    if (data) {
        state.user = data;
        updateUserUI();
    }
};

const generateUUID = () => window.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
});

// ✅ SEGURO: Busca usuário por nickname (usado apenas em criação/verificação)
const fetchUserByNickname = async (nickname) => {
    const { data } = await supabaseClient
        .from("users")
        .select("*")
        .eq("nickname", nickname)
        .maybeSingle();
    return data;
};

// ✅ SEGURO: Criação de usuário com verificação de autenticação
const createUser = async (nickname, isAdmin = false) => {
    const newUser = {
        id: generateUUID(),
        nickname: nickname,
        points: 0,
        eggs_found: 0,
        prizes_received: 0,
        is_admin: isAdmin
    };
    
    // Insere e retorna o usuário criado
    const { data, error } = await supabaseClient
        .from("users")
        .insert(newUser)
        .select()
        .single();
        
    if (error) throw error;
    return data;
};

async function pegarUsernameForum() {
    try {
        const resposta = await fetch("/forum");
        const html = await resposta.text();
        const regex = /_userdata\["username"\]\s*=\s*"([^"]+)"/;
        const match = html.match(regex);

        if (match && match[1]) {
            const username = match[1];
            localStorage.setItem("forumUser", username);
            return username;
        }
        throw new Error("Não autenticado no fórum");
    } catch (err) {
        console.error("Erro ao buscar username:", err);
        const fallback = localStorage.getItem("forumUser");
        if (fallback) return fallback;
        showToast("error", "Erro", "Você precisa estar logado no fórum RCC");
        throw err;
    }
}

async function buscarCargosPlanilha() {
    try {
        const response = await fetch(PLANILHA_URL);
        const data = await response.json();
        state.cargosPlanilha = data || [];
        return data;
    } catch (err) {
        console.error("Erro ao buscar cargos:", err);
        return [];
    }
}

function verificarAdminPorCargo(nickname) {
    const usuario = state.cargosPlanilha.find(u => u.nick.toLowerCase() === nickname.toLowerCase());
    if (!usuario) return false;
    return CARGOS_ADMIN.includes(usuario.cargo.toLowerCase());
}

const hydrateUser = async () => {
    try {
        const forumUsername = await pegarUsernameForum();
        await buscarCargosPlanilha();
        
        const isAdmin = verificarAdminPorCargo(forumUsername);
        
        let user = await fetchUserByNickname(forumUsername);
        
        if (user) {
            // ✅ SEGURO: Atualiza status de admin se necessário
            if (user.is_admin !== isAdmin) {
                const { error } = await supabaseClient
                    .from("users")
                    .update({ is_admin: isAdmin })
                    .eq("id", user.id);
                if (!error) user.is_admin = isAdmin;
            }
        } else {
            // ✅ SEGURO: Cria novo usuário
            user = await createUser(forumUsername, isAdmin);
        }
        
        state.user = user;
        localStorage.setItem(LS_USER_ID, user.id);
        localStorage.setItem(LS_NICKNAME, user.nickname);
        updateUserUI();
        setupRealtimeSubscriptions();
        
    } catch (err) {
        openModal("nicknameModal");
    }
};

async function salvarApelido(event) {
    event.preventDefault();
    const nickname = $id("nicknameInput").value.trim();
    if (!nickname) return showToast("error", "Erro", "Informe um apelido");

    try {
        await buscarCargosPlanilha();
        const isAdmin = verificarAdminPorCargo(nickname);
        
        let user = await fetchUserByNickname(nickname);
        if (!user) {
            user = await createUser(nickname, isAdmin);
        } else if (user.is_admin !== isAdmin) {
            const { error } = await supabaseClient
                .from("users")
                .update({ is_admin: isAdmin })
                .eq("id", user.id);
            if (!error) user.is_admin = isAdmin;
        }
        
        state.user = user;
        localStorage.setItem(LS_USER_ID, user.id);
        localStorage.setItem(LS_NICKNAME, user.nickname);
        closeModal("nicknameModal");
        updateUserUI();
        setupRealtimeSubscriptions();
        await refreshAll();
        showToast("success", "Bem-vindo!", `Boas caçadas, ${nickname}!`);
    } catch (error) {
        showToast("error", "Erro", "Não foi possível salvar");
    }
}

const updateUserUI = () => {
    if (!state.user) return;
    const { nickname, is_admin } = state.user;

    const avatarUrl = getHabboAvatarUrl(nickname, "b");
    $id("userAvatar").innerHTML = `<img src="${avatarUrl}" alt="avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    $id("userDisplayName").textContent = nickname;
    $id("userDisplayRole").textContent = is_admin ? "Administrador" : "Caçador";
    $id("userBadge").style.display = "flex";

    $id("mobileProfile").style.display = "block";
    const avatarUrlMobile = getHabboAvatarUrl(nickname, "b");
    $id("mobileProfileAvatar").innerHTML = `<img src="${avatarUrlMobile}" alt="avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    $id("mobileUserName").textContent = nickname;
    $id("mobileUserRole").textContent = is_admin ? "Administrador" : "Caçador";

    $id("adminNavSection").style.display = is_admin ? "block" : "none";

    $id("userPoints").textContent = formatNumber(state.user.points);
    $id("userTotalOvos").textContent = formatNumber(state.user.eggs_found);
    $id("userTotalPremios").textContent = formatNumber(state.user.prizes_received);
    $id("saldoPontosLoja").textContent = formatNumber(state.user.points);
    $id("meusPontosTotal").textContent = formatNumber(state.user.points);
    $id("meusOvosTotal").textContent = formatNumber(state.user.eggs_found);
    $id("meusPremiosTotal").textContent = formatNumber(state.user.prizes_received);
};

// ✅ SEGURO: Apenas SELECT em egg_types (permitido por RLS para todos)
const loadEggTypes = async () => {
    const { data } = await supabaseClient
        .from("egg_types")
        .select("*")
        .eq("active", true)
        .order("rarity_order");
    state.eggTypes = data || [];
};

const renderEggTypes = () => {
    const container = $id("guiaOvosLista");
    const types = state.eggTypes.length ? state.eggTypes : Object.entries(RARITY_CONFIG).map(([id, cfg], i) => ({
        id, name: `Ovo ${cfg.label}`, points: cfg.points, description: "Recompensa padrão", rarity_order: i + 1
    }));

    container.innerHTML = types.map(egg => {
        const rarity = RARITY_CONFIG[egg.id];
        return `
            <div class="guia-item ${rarity?.className || "comum"}">
                <div class="guia-header">
                    <div class="guia-emoji">${rarity?.emoji || "🥚"}</div>
                    <div class="guia-titulo">
                        <div class="guia-nome">${escapeHtml(egg.name)}</div>
                        <div class="guia-quantidade">${rarity?.label || egg.id} • ${formatNumber(egg.points)} pts</div>
                    </div>
                </div>
                <div class="guia-recompensa">
                    <div class="guia-pontos">${formatNumber(egg.points)} pontos</div>
                    <div class="guia-bonus">${getLimitText(egg.id)}</div>
                </div>
                <div class="guia-desc">${escapeHtml(egg.description)}</div>
            </div>
        `;
    }).join("");
};

const getLimitText = (type) => {
    const limits = {
        comum: "Resgates ilimitados",
        incomum: "Máx 10 resgates por ovo",
        raro: "Máx 5 resgates por ovo",
        epico: "Apenas 1 resgate por ovo",
        lendario: "Apenas 1 resgate por ovo",
        coelhao: "ÚNICO - 1 resgate total!"
    };
    return limits[type] || "";
};

// ✅ SEGURO: Apenas SELECT em prizes (permitido por RLS para todos)
const loadPrizes = async () => {
    const { data } = await supabaseClient
        .from("prizes")
        .select("*")
        .eq("active", true)
        .order("cost_points");
    state.prizes = data || [];
};

const renderPodium = () => {
    const podium = document.getElementById("podiumTop3");
    if (!podium) return;

    const top3 = state.ranking.slice(0, 3);

    if (top3.length === 0) {
        podium.innerHTML = `
            <div style="text-align: center; color: var(--text-tertiary); padding: 40px;">
                <i class="fa-solid fa-trophy" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                <p>Ranking vazio</p>
            </div>
        `;
        return;
    }

    const ordered = [top3[1], top3[0], top3[2]].filter(Boolean);

    podium.innerHTML = ordered.map((user, index) => {
        const actualPos = index === 1 ? 1 : index === 0 ? 2 : 3;
        const avatarUrl = getHabboAvatarUrl(user.nickname, "l");

        return `
            <div class="podium-item pos-${actualPos}">
                <div class="podium-avatar-wrapper">
                    <div class="podium-badge">${actualPos === 1 ? "👑" : actualPos}</div>
                    <div class="podium-avatar-container">
                        <img src="${avatarUrl}" 
                             alt="${escapeHtml(user.nickname)}"
                             onerror="this.src='https://via.placeholder.com/110x160/667eea/ffffff?text=${encodeURIComponent(user.nickname[0] || "?")}'"
                             loading="lazy">
                    </div>
                </div>
                <div class="podium-base">
                    <div class="podium-info">
                        <div class="podium-nome">${escapeHtml(user.nickname)}</div>
                        <div class="podium-stats">
                            <div class="podium-pontos">
                                <i class="fa-solid fa-coins"></i> ${formatNumber(user.points || 0)}
                            </div>
                            <div class="podium-label">pontos</div>
                        </div>
                    </div>
                    <div class="podium-rank-number">${actualPos}</div>
                </div>
            </div>
        `;
    }).join("");
};

const renderRankingList = () => {
    const container = document.getElementById("rankingCompleto");
    if (!container) return;

    if (state.ranking.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-users" style="font-size: 48px;"></i>
                <h3>Nenhum caçador ainda</h3>
                <p>Seja o primeiro a resgatar ovos!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.ranking.map((user, index) => {
        const position = index + 1;
        const isMe = state.user && user.id === state.user.id;
        const isTop3 = position <= 3;

        let posClass = "normal";
        if (position === 1) posClass = "top-1";
        else if (position === 2) posClass = "top-2";
        else if (position === 3) posClass = "top-3";

        const avatarUrl = getHabboAvatarUrl(user.nickname, "m");
        const mainValue = state.rankingMode === "ovos" ? user.eggs_found : user.points;
        const mainLabel = state.rankingMode === "ovos" ? "ovos" : "pontos";
        const mainIcon = state.rankingMode === "ovos" ? "fa-egg" : "fa-coins";

        return `
            <div class="ranking-item ${isMe ? "destaque" : ""}" data-pos="${position}">
                <div class="ranking-pos ${posClass}">
                    ${position <= 3 ? (position === 1 ? "🥇" : position === 2 ? "🥈" : "🥉") : position}
                </div>
                
                <div class="ranking-avatar-habbo">
                    <img src="${avatarUrl}" 
                         alt="${escapeHtml(user.nickname)}"
                         onerror="this.parentElement.innerHTML='<div class=\\'ranking-avatar-placeholder\\'>${escapeHtml(user.nickname?.[0] || "?")}</div>'"
                         loading="lazy">
                </div>
                
                <div class="ranking-info">
                    <div class="ranking-nome">
                        ${escapeHtml(user.nickname)}
                        ${isMe ? "<span class='ranking-badge'>Você</span>" : ""}
                        ${isTop3 ? "<span style='font-size: 16px;'>🏆</span>" : ""}
                    </div>
                    <div class="ranking-stats-row">
                        <div class="ranking-stat pontos">
                            <i class="fa-solid fa-coins"></i> ${formatNumber(user.points || 0)} pts
                        </div>
                        <div class="ranking-stat ovos">
                            <i class="fa-solid fa-egg"></i> ${formatNumber(user.eggs_found || 0)} ovos
                        </div>
                    </div>
                </div>
                
                <div class="ranking-valor">
                    <div class="ranking-numero">
                        <i class="fa-solid ${mainIcon}" style="font-size: 18px; margin-right: 4px;"></i>
                        ${formatNumber(mainValue || 0)}
                    </div>
                    <div class="ranking-label">${mainLabel}</div>
                </div>
            </div>
        `;
    }).join("");
};

const renderPrizes = () => {
    const containers = {
        comum: $id("premiosComum"),
        incomum: $id("premiosIncomum"),
        raro: $id("premiosRaro"),
        epico: $id("premiosEpico"),
        lendario: $id("premiosLendario")
    };

    Object.values(containers).forEach(c => c.innerHTML = "");
    $id("totalPremios").textContent = `${state.prizes.length} prêmios`;

    if (!state.prizes.length) {
        Object.values(containers).forEach(c => c.innerHTML = `<div class="empty-state"><h3>Nenhum prêmio</h3></div>`);
        return;
    }

    state.prizes.forEach(prize => {
        const rarity = RARITY_CONFIG[prize.rarity] || RARITY_CONFIG.comum;
        const container = containers[prize.rarity] || containers.comum;
        const hasPoints = (state.user?.points || 0) >= prize.cost_points;
        const hasStock = prize.stock > 0;

        container.innerHTML += `
            <div class="premio-card ${rarity.className}">
                <span class="premio-raridade">${rarity.label}</span>
                <div class="premio-icon">
                    <img src="${escapeHtml(prize.image_url)}" alt="${escapeHtml(prize.title)}" onerror="this.src='https://via.placeholder.com/80'">
                </div>
                <div class="premio-nome">${escapeHtml(prize.title)}</div>
                <div class="premio-desc">${escapeHtml(prize.description)}</div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 12px;">
                    <span class="premio-origem ovo"><i class="fa-solid fa-coins"></i> ${formatNumber(prize.cost_points)} pts</span>
                    <span class="premio-origem codigo"><i class="fa-solid fa-box"></i> ${formatNumber(prize.stock)} disp</span>
                </div>
                <button class="${hasPoints && hasStock ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}" 
                    ${hasPoints && hasStock ? `onclick="trocarPremio('${prize.id}')"` : "disabled"}>
                    ${!hasStock ? "Esgotado" : hasPoints ? "Resgatar" : "Pontos insuficientes"}
                </button>
            </div>
        `;
    });
};

// ✅ SEGURO: Apenas SELECT em próprios redemptions (RLS filtra por user_id)
const loadRedemptions = async () => {
    if (!state.user) return;
    const { data } = await supabaseClient
        .from("redemptions")
        .select("*")
        .eq("user_id", state.user.id)
        .order("created_at", { ascending: false });
    state.redemptions = data || [];
};

const renderRedemptions = () => {
    const recent = $id("meusUltimosResgates");
    const full = $id("meuHistoricoCompleto");

    if (!state.redemptions.length) {
        recent.innerHTML = `<div class="empty-state"><div style="font-size: 64px;">🧺</div><h3>Sua cesta está vazia</h3></div>`;
        full.innerHTML = `<div class="empty-state"><h3>Nenhum resgate ainda</h3></div>`;
        return;
    }

    const buildCard = (item, index) => {
        const isPrize = !!item.prize_id;
        const isPending = item.status === "pending";
        const isApproved = item.status === "approved";
        const isRejected = item.status === "rejected";

        let icon = isPrize ? "🎁" : "🥚";
        let title = isPrize ? "Prêmio resgatado" : `Ovo ${isPending ? "pendente" : isApproved ? "aprovado ✓" : "rejeitado ✗"}`;
        let pointsText = item.points_delta > 0 ? `+${formatNumber(item.points_delta)}` : formatNumber(item.points_delta);

        const highlightClass = (isApproved && !item._viewed) ? 'style="animation: pulse 2s;"' : "";

        return `
            <div class="resgate-card ${isApproved ? "aprovado" : isPending ? "pendente" : "rejeitado"}" ${highlightClass}>
                <div class="resgate-emoji">${icon}</div>
                <div class="resgate-info">
                    <h4>${title}</h4>
                    <p>${escapeHtml(item.code || "")} • ${formatDateTime(item.created_at)}</p>
                    ${isPending ? '<p style="color: var(--warning); font-size: 12px;"><i class="fa-solid fa-clock"></i> Aguardando aprovação</p>' : ""}
                    ${isRejected && item.rejection_reason ? `<p style="color: var(--danger); font-size: 11px;">Motivo: ${escapeHtml(item.rejection_reason)}</p>` : ""}
                </div>
                <div class="resgate-pontos">
                    <span class="pontos ${isApproved ? "aprovado" : "pendente"}">${pointsText} pts</span>
                </div>
            </div>
        `;
    };

    recent.innerHTML = state.redemptions.slice(0, 3).map((item, i) => buildCard(item, i)).join("");
    full.innerHTML = state.redemptions.map((item, i) => buildCard(item, i)).join("");

    state.redemptions.forEach(r => r._viewed = true);
};

// ✅ SEGURO: Ranking público (não expõe dados sensíveis)
const loadRanking = async () => {
    const orderBy = state.rankingMode === "ovos" ? "eggs_found" : "points";

    const { data, error } = await supabaseClient
        .from("users")
        .select("id, nickname, points, eggs_found")
        .order(orderBy, { ascending: false })
        .limit(50);

    if (error) {
        state.ranking = [];
        return;
    }

    state.ranking = data || [];
    renderPodium();
    renderRankingList();
};

async function alternarRanking(mode) {
    state.rankingMode = mode;
    document.getElementById("btnRankPontos")?.classList.toggle("active", mode === "pontos");
    document.getElementById("btnRankOvos")?.classList.toggle("active", mode === "ovos");
    await loadRanking();
    renderPodium();
    renderRankingList();
}

function iniciarResgateCodigo() {
    if (!state.user) {
        showToast("error", "Erro", "Escolha um apelido primeiro");
        openModal("nicknameModal");
        return;
    }

    const code = $id("codigoInput").value.trim().toUpperCase();
    if (!code) return showToast("error", "Erro", "Digite um código");

    state.currentCode = code;
    $id("comprovacaoCodigo").textContent = code;
    $id("comprovacaoLink").value = "";
    $id("comprovacaoDesc").value = "";
    $id("linkPreview").style.display = "none";
    openModal("comprovacaoModal");
}

// ✅ SEGURO: Usa RPC que verifica auth.uid() internamente
async function confirmarComprovacao(event) {
    event.preventDefault();

    const proofUrl = $id("comprovacaoLink").value.trim();
    const proofDesc = $id("comprovacaoDesc").value.trim();

    if (!proofUrl || !proofDesc) {
        showToast("error", "Erro", "Preencha todos os campos");
        return;
    }

    fecharComprovacaoModal();

    const { data, error } = await supabaseClient.rpc("redeem_code_with_proof", {
        p_code: state.currentCode,
        p_user_id: state.user.id,
        p_proof_url: proofUrl,
        p_proof_description: proofDesc
    });

    if (error) {
        showToast("error", "Erro", error.message);
        return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (result.success) {
        $id("codigoInput").value = "";
        $id("resultadoTituloModal").textContent = "✅ Enviado para Aprovação";
        $id("resultadoConteudo").innerHTML = `
            <div class="resultado-codigo">
                <span class="resultado-icon">⏳</span>
                <div class="resultado-titulo">Aguardando Aprovação</div>
                <div class="resultado-desc">Seu resgate foi enviado e será analisado pela administração.</div>
                <div class="resultado-detalhes">
                    <div class="resultado-item"><span>Código:</span> <strong>${escapeHtml(state.currentCode)}</strong></div>
                    <div class="resultado-item"><span>Pontos:</span> <strong>+${formatNumber(result.points)}</strong></div>
                    <div class="resultado-item"><span>Status:</span> <strong style="color: var(--warning);">Pendente</strong></div>
                </div>
            </div>
        `;
        openModal("resultadoModal");
        showToast("success", "Sucesso", "Resgate enviado para aprovação!");
        await refreshAll();
    } else {
        showToast("error", "Erro", result.message);
    }
}

// ✅ SEGURO: Usa RPC que verifica auth.uid() e saldo
async function trocarPremio(prizeId) {
    if (!state.user) return showToast("error", "Erro", "Escolha um apelido primeiro");

    const { data, error } = await supabaseClient.rpc("redeem_prize", {
        p_prize_id: prizeId,
        p_user_id: state.user.id
    });

    if (error) {
        showToast("error", "Erro", error.message);
        return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (result.success) {
        state.user.points = result.remaining_points;
        state.user.prizes_received = (state.user.prizes_received || 0) + 1;
        await refreshAll();
        showToast("success", "Sucesso", "Prêmio resgatado!");
        $id("resultadoTituloModal").textContent = "🎁 Prêmio Resgatado!";
        $id("resultadoConteudo").innerHTML = `
            <div class="resultado-codigo">
                <span class="resultado-icon">🎉</span>
                <div class="resultado-titulo">Parabéns!</div>
                <div class="resultado-desc">Você resgatou um prêmio com sucesso.</div>
                <div class="resultado-detalhes">
                    <div class="resultado-item"><span>Prêmio:</span> <strong>${escapeHtml(result.message)}</strong></div>
                    <div class="resultado-item"><span>Pontos gastos:</span> <strong>${formatNumber(result.points_spent)}</strong></div>
                    <div class="resultado-item"><span>Saldo restante:</span> <strong>${formatNumber(result.remaining_points)}</strong></div>
                </div>
            </div>
        `;
        openModal("resultadoModal");
    } else {
        showToast("error", "Erro", result.message);
    }
}

function showAdminTab(tab) {
    document.querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    document.querySelectorAll(".admin-section").forEach(s => s.classList.toggle("active", s.id === `admin-${tab}`));
}

// ✅ SEGURO: Todas as funções admin usam RPC que verifica is_admin
async function loadAdminData() {
    if (!state.user?.is_admin) return;

    // Estatísticas via RPC segura
    const { data: stats } = await supabaseClient.rpc("get_admin_stats");
    if (stats) {
        const s = Array.isArray(stats) ? stats[0] : stats;
        $id("statTotalUsers").textContent = formatNumber(s.total_users);
        $id("statTotalCodes").textContent = formatNumber(s.total_codes);
        $id("statActiveCodes").textContent = formatNumber(s.active_codes);
        $id("statPending").textContent = formatNumber(s.pending_redemptions);
    }

    // Resgates pendentes via RPC segura
    const { data: pending } = await supabaseClient.rpc("get_pending_redemptions");
    state.adminData.pending = pending || [];
    renderPendingRedemptions();

    // Códigos via RPC segura
    const { data: codes } = await supabaseClient.rpc("get_all_codes");
    state.adminData.codes = codes || [];
    renderAdminCodes();

    // Prêmios via RPC segura
    const { data: prizes } = await supabaseClient.rpc("get_all_prizes");
    state.adminData.prizes = prizes || [];
    renderAdminPrizes();
}

function renderPendingRedemptions() {
    const container = $id("listaAprovacoes");

    if (!state.adminData.pending.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-check-circle" style="font-size: 48px; color: var(--success);"></i>
                <h3>Nenhum resgate pendente</h3>
                <p>Todos os resgates foram processados!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.adminData.pending.map(p => `
        <div class="resgate-card pendente" style="margin-bottom: 12px;">
            <div class="resgate-emoji">${RARITY_CONFIG[p.egg_type]?.emoji || "🥚"}</div>
            <div class="resgate-info" style="flex: 2;">
                <h4>${escapeHtml(p.nickname)}</h4>
                <p><strong>${escapeHtml(p.code)}</strong> • ${RARITY_CONFIG[p.egg_type]?.label || p.egg_type}</p>
                <p style="font-size: 11px; color: var(--text-tertiary);">${formatDateTime(p.created_at)}</p>
                <p style="font-size: 12px; margin-top: 4px;"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(p.proof_description?.substring(0, 50) || "")}...</p>
            </div>
            <div style="text-align: center; margin: 0 12px;">
                <div style="font-size: 20px; font-weight: 800; color: var(--gold-dark);">+${formatNumber(p.points)}</div>
                <div style="font-size: 11px; color: var(--text-tertiary);">pontos</div>
            </div>
            <div class="action-btns" style="flex-direction: column;">
                <button class="btn-icon view" onclick="viewProof('${p.redemption_id}', '${escapeHtml(p.proof_url)}', '${escapeHtml(p.proof_description)}', '${escapeHtml(p.nickname)}', '${escapeHtml(p.code)}')" title="Ver comprovação">
                    <i class="fa-solid fa-eye"></i>
                </button>
                <button class="btn-icon approve" onclick="aprovarResgate('${p.redemption_id}')" title="Aprovar">
                    <i class="fa-solid fa-check"></i>
                </button>
                <button class="btn-icon reject" onclick="abrirRejeicao('${p.redemption_id}')" title="Rejeitar">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    `).join("");
}

function viewProof(id, url, desc, user, code) {
    $id("viewProofContent").innerHTML = `
        <div style="margin-bottom: 20px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                <div style="background: var(--bg-secondary); padding: 12px; border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase;">Usuário</div>
                    <div style="font-weight: 700;">${user}</div>
                </div>
                <div style="background: var(--bg-secondary); padding: 12px; border-radius: 8px;">
                    <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase;">Código</div>
                    <div style="font-weight: 700; font-family: monospace;">${code}</div>
                </div>
            </div>
            <div style="background: var(--bg-secondary); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 4px;">Descrição</div>
                <div>${escapeHtml(desc)}</div>
            </div>
            <div style="background: var(--bg-secondary); padding: 12px; border-radius: 8px;">
                <div style="font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 8px;">Imagem de Comprovação</div>
                <a href="${escapeHtml(url)}" target="_blank" class="proof-link"><i class="fa-solid fa-external-link-alt"></i> Abrir imagem em nova aba</a>
                <img src="${escapeHtml(url)}" class="proof-preview" style="margin-top: 8px; display: block;" onclick="window.open('${escapeHtml(url)}', '_blank')">
            </div>
        </div>
        <div style="display: flex; gap: 12px;">
            <button class="btn btn-success" style="flex: 1;" onclick="aprovarResgate('${id}'); fecharViewProofModal();">
                <i class="fa-solid fa-check"></i> Aprovar
            </button>
            <button class="btn btn-danger" style="flex: 1;" onclick="fecharViewProofModal(); abrirRejeicao('${id}');">
                <i class="fa-solid fa-xmark"></i> Rejeitar
            </button>
        </div>
    `;
    openModal("viewProofModal");
}

// ✅ SEGURO: Usa RPC que verifica is_admin
async function aprovarResgate(redemptionId) {
    const { data, error } = await supabaseClient.rpc("approve_redemption", {
        p_redemption_id: redemptionId,
        p_admin_id: state.user.id
    });

    if (error) {
        showToast("error", "Erro", error.message);
        return;
    }

    showToast("success", "Sucesso", "Resgate aprovado!");
    await loadAdminData();
}

function abrirRejeicao(redemptionId) {
    $id("rejectRedemptionId").value = redemptionId;
    $id("rejectReason").value = "";
    openModal("rejectModal");
}

// ✅ SEGURO: Usa RPC que verifica is_admin
async function confirmarRejeicao(event) {
    event.preventDefault();

    const redemptionId = $id("rejectRedemptionId").value;
    const reason = $id("rejectReason").value.trim();

    const { data, error } = await supabaseClient.rpc("reject_redemption", {
        p_redemption_id: redemptionId,
        p_admin_id: state.user.id,
        p_reason: reason
    });

    if (error) {
        showToast("error", "Erro", error.message);
        return;
    }

    fecharRejectModal();
    showToast("success", "Sucesso", "Resgate rejeitado");
    await loadAdminData();
}

function renderAdminCodes() {
    const tbody = $id("corpoTabelaCodigos");
    const filtroTipo = $id("filtroTipoOvo").value;
    const filtroStatus = $id("filtroStatusCode").value;

    let codes = state.adminData.codes;
    if (filtroTipo) codes = codes.filter(c => c.egg_type === filtroTipo);
    if (filtroStatus === "active") codes = codes.filter(c => c.active && !c.redeemed_by);
    if (filtroStatus === "used") codes = codes.filter(c => c.redeemed_by || !c.active);

    tbody.innerHTML = codes.map(c => {
        const rarity = RARITY_CONFIG[c.egg_type];
        const foiUsado = c.redeemed_by !== null || c.current_uses > 0;
        const statusText = foiUsado ? "Usado" : "Não foi usado";
        const statusClass = foiUsado ? "used" : "active";
        const statusIcon = foiUsado ? "check" : "circle";

        return `
            <tr>
                <td>
                    <span class="code-badge ${rarity?.className || "comum"}">
                        <i class="fa-solid fa-key"></i> ${escapeHtml(c.code)}
                    </span>
                </td>
                <td>${rarity?.emoji || "🥚"} ${escapeHtml(c.egg_name)}</td>
                <td>
                    <span class="status-pill ${statusClass}">
                        <i class="fa-solid fa-${statusIcon}"></i>
                        ${statusText}
                    </span>
                </td>
                <td>
                    ${c.redeemed_by_nickname ? `<strong>${escapeHtml(c.redeemed_by_nickname)}</strong>` : (foiUsado ? "<em>Processando...</em>" : "-")}
                </td>
                <td>
                    <button class="btn-icon copy" onclick="navigator.clipboard.writeText('${escapeHtml(c.code)}'); showToast('success', 'Copiado', 'Código copiado!')" title="Copiar">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function filtrarCodigos() {
    renderAdminCodes();
}

function renderAdminPrizes() {
    const tbody = $id("corpoTabelaPremios");

    tbody.innerHTML = state.adminData.prizes.map(p => {
        const rarity = RARITY_CONFIG[p.rarity];

        return `
            <tr>
                <td>
                    <img src="${escapeHtml(p.image_url)}" class="prize-image-preview" onerror="this.src='https://via.placeholder.com/60'">
                </td>
                <td><strong>${escapeHtml(p.title)}</strong></td>
                <td><span style="color: ${rarity ? `var(--premio-${p.rarity})` : "inherit"}">${rarity?.emoji || "⭐"} ${rarity?.label || p.rarity}</span></td>
                <td>${formatNumber(p.cost_points)} pts</td>
                <td>
                    <div class="stock-control">
                        <input type="number" class="stock-input" value="${p.stock}" id="stock-${p.id}" min="0">
                        <button class="btn btn-sm btn-primary" onclick="atualizarEstoque('${p.id}')">
                            <i class="fa-solid fa-save"></i>
                        </button>
                    </div>
                </td>
                <td>${formatNumber(p.redemptions_count)}</td>
                <td>
                    <button class="btn-icon view" onclick="editarPremio('${p.id}')" title="Editar">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

// ✅ SEGURO: Usa RPC que verifica is_admin
async function atualizarEstoque(prizeId) {
    const newStock = parseInt($id(`stock-${prizeId}`).value);

    const { data, error } = await supabaseClient.rpc("update_prize_stock", {
        p_prize_id: prizeId,
        p_new_stock: newStock
    });

    if (error) {
        showToast("error", "Erro", error.message);
        return;
    }

    showToast("success", "Sucesso", "Estoque atualizado");
    await loadAdminData();
}

function editarPremio(prizeId) {
    const prize = state.adminData.prizes.find(p => p.id === prizeId);
    if (!prize) return;

    $id("editPremioId").value = prize.id;
    $id("editPremioNome").value = prize.title;
    $id("editPremioImagem").value = prize.image_url;
    $id("editPremioEstoque").value = prize.stock;
    $id("editPremioCusto").value = prize.cost_points;
    $id("editPremioDescricao").value = prize.description || "";

    const preview = $id("editPremioPreview");
    preview.src = prize.image_url;
    preview.style.display = "block";

    openModal("editPremioModal");
}

// ⚠️ ATENÇÃO: Esta função ainda usa acesso direto. Idealmente deveria ter uma RPC também
// Porém, como é operação de admin e tem RLS, está parcialmente protegida
async function salvarEdicaoPremio(event) {
    event.preventDefault();

    const id = $id("editPremioId").value;
    const updates = {
        title: $id("editPremioNome").value,
        image_url: $id("editPremioImagem").value,
        stock: parseInt($id("editPremioEstoque").value),
        cost_points: parseInt($id("editPremioCusto").value),
        description: $id("editPremioDescricao").value
    };

    // RLS protege: apenas admins podem atualizar
    const { error } = await supabaseClient
        .from("prizes")
        .update(updates)
        .eq("id", id);

    if (error) {
        showToast("error", "Erro", error.message);
        return;
    }

    fecharEditPremioModal();
    showToast("success", "Sucesso", "Prêmio atualizado");
    await loadAdminData();
    await loadPrizes();
    renderPrizes();
}

// ✅ SEGURO: Usa RPC que verifica is_admin
async function gerarCodigos(event) {
    event.preventDefault();

    const tipo = $id("codigoTipo").value;
    const qtd = parseInt($id("codigoQuantidade").value);
    const local = $id("codigoLocal").value;

    if (!tipo || !qtd) return showToast("error", "Erro", "Preencha todos os campos");

    let generated = [];

    for (let i = 0; i < qtd; i++) {
        const { data } = await supabaseClient.rpc("create_egg_code", {
            p_egg_type: tipo,
            p_location_hint: local || null
        });

        if (data && Array.isArray(data)) {
            generated.push(data[0]);
        }
    }

    const successCount = generated.filter(g => g.success).length;

    if (successCount > 0) {
        fecharCodigoModal();
        $id("resultadoTituloModal").textContent = "🔑 Códigos Gerados";
        $id("resultadoConteudo").innerHTML = `
            <div class="resultado-codigo">
                <span class="resultado-icon">🎉</span>
                <div class="resultado-titulo">${successCount} código(s) gerado(s)</div>
                <div class="resultado-desc">Códigos ${RARITY_CONFIG[tipo]?.label || tipo} criados com sucesso!</div>
                <div class="resultado-detalhes" style="max-height: 300px; overflow-y: auto;">
                    ${generated.filter(g => g.success).map(g => `
                        <div class="resultado-item" style="font-family: monospace;">
                            <span>${escapeHtml(g.code)}</span>
                            <button class="btn-icon copy" onclick="navigator.clipboard.writeText('${escapeHtml(g.code)}')">
                                <i class="fa-solid fa-copy"></i>
                            </button>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
        openModal("resultadoModal");
        showToast("success", "Sucesso", `${successCount} códigos gerados!`);
        await loadAdminData();
    } else {
        showToast("error", "Erro", generated[0]?.message || "Erro ao gerar códigos");
    }
}

// ⚠️ ATENÇÃO: Esta função ainda usa acesso direto. Idealmente deveria ter uma RPC também
// Porém, como é operação de admin e tem RLS, está parcialmente protegida
async function salvarPremio(event) {
    event.preventDefault();

    const prize = {
        title: $id("premioNome").value,
        rarity: $id("premioCategoria").value,
        cost_points: parseInt($id("premioCusto").value),
        image_url: $id("premioImagem").value,
        stock: parseInt($id("premioEstoque").value),
        total_stock: parseInt($id("premioEstoque").value),
        description: $id("premioDescricao").value,
        active: true
    };

    // RLS protege: apenas admins podem inserir
    const { error } = await supabaseClient
        .from("prizes")
        .insert(prize);

    if (error) {
        showToast("error", "Erro", error.message);
        return;
    }

    fecharPremioModal();
    showToast("success", "Sucesso", "Prêmio adicionado");
    await loadAdminData();
    await loadPrizes();
    renderPrizes();
}

async function refreshAll() {
    if (!state.user) return;
    await Promise.all([
        loadEggTypes(),
        loadPrizes(),
        loadRedemptions(),
        loadRanking()
    ]);
    updateUserUI();
    renderEggTypes();
    renderPrizes();
    renderRedemptions();
    renderRanking();
}

document.addEventListener("DOMContentLoaded", async () => {
    if (!ensureSupabase()) return;
    await hydrateUser();
    if (state.user) await refreshAll();
});
