        /**
         * INStore Páscoa — script.js
         * Autenticação via Supabase Auth (magic link ou OTP)
         * Toda operação sensível é feita server-side (triggers / Edge Functions)
         * O cliente NUNCA manipula pontos ou status diretamente.
         *
         * Configuração:
         * 1. Substitua SUPABASE_URL e SUPABASE_ANON_KEY pelos seus valores.
         * 2. Suba o schema SQL no Supabase.
         * 3. Deploy da Edge Function sync-habbo-members.
         */

        // ═══════════════════════════════════════════════════
        // CONFIGURAÇÃO
        // ═══════════════════════════════════════════════════
        const SUPABASE_URL     = "https://SEU_PROJETO.supabase.co"; // <-- ALTERE AQUI
        const SUPABASE_ANON_KEY = "SUA_ANON_KEY"; // <-- ALTERE AQUI (pública — OK ficar no JS)

        const { createClient } = supabase; // carregado via CDN no HTML
        const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
            },
        });

        // ═══════════════════════════════════════════════════
        // ESTADO GLOBAL
        // ═══════════════════════════════════════════════════
        let currentUser   = null; // dados de auth.users (JWT)
        let currentProfile = null; // dados de public.users
        let rankingMode   = "pontos";
        let pendingCodeId = null;  // id do código verificado aguardando comprovação

        // ═══════════════════════════════════════════════════
        // DADOS DOS OVOS (somente informação pública/estática)
        // ═══════════════════════════════════════════════════
        const TIPOS_OVO = {
            comum:    { emoji: "🥚", nome: "Ovo Comum",    pontos: 5,   maxUsos: "Ilimitado", classe: "comum",    desc: "Encontrado facilmente pelos corredores da companhia." },
            incomum:  { emoji: "🍀", nome: "Ovo Incomum",  pontos: 10,  maxUsos: "10 usos",  classe: "incomum", desc: "Mais raro, escondido em lugares menos óbvios." },
            raro:     { emoji: "💎", nome: "Ovo Raro",     pontos: 30,  maxUsos: "5 usos",   classe: "raro",    desc: "Difícil de encontrar, vale a pena procurar!" },
            epico:    { emoji: "👑", nome: "Ovo Épico",    pontos: 50,  maxUsos: "1 uso",    classe: "epico",   desc: "Extremamente raro. Apenas um jogador pode resgatar." },
            lendario: { emoji: "🏆", nome: "Ovo Lendário", pontos: 100, maxUsos: "1 uso",    classe: "lendario",desc: "Lendário. Encontrá-lo é uma conquista histórica." },
            coelhao:  { emoji: "🐰", nome: "Coelhão",      pontos: 500, maxUsos: "ÚNICO",    classe: "coelhao", desc: "O ovo supremo. Apenas um existe no mundo inteiro." },
        };

        // ═══════════════════════════════════════════════════
        // INICIALIZAÇÃO
        // ═══════════════════════════════════════════════════
        document.addEventListener("DOMContentLoaded", async () => {
            renderGuiaOvos();
            await iniciarSessao();
            setupRealtimeRanking();
        });

        async function iniciarSessao() {
            const { data: { session } } = await db.auth.getSession();
            if (session) {
                currentUser = session.user;
                await carregarPerfil();
            } else {
                mostrarLoginModal();
            }
        }

        // ═══════════════════════════════════════════════════
        // AUTENTICAÇÃO — Integração Fórum + AppScript + Supabase
        // ═══════════════════════════════════════════════════
        async function iniciarSessao() {
            try {
                // 1. Puxa o nick do fórum (Abaixo você configura essa função)
                const nickForum = await obterNickDoForum();

                if (!nickForum) {
                    mostrarAcessoNegado("Você precisa estar logado no fórum INStore para acessar a loja.");
                    return;
                }

                // 2. Puxa a lista do Google Apps Script e verifica se o usuário está nela
                const infoINS = await verificarSeEIns(nickForum);

                if (!infoINS.valido) {
                    mostrarAcessoNegado(`Acesso negado. O nick "${nickForum}" não foi encontrado na lista da INS.`);
                    return;
                }

                // 3. Sucesso! Configura o usuário atual
                currentUser = { 
                    id: nickForum, 
                    role: infoINS.isAdmin ? 'admin' : 'user' 
                };
                
                // 4. Conecta com o Supabase para carregar ou criar o perfil!
                await carregarPerfilNoSupabase(nickForum, currentUser.role);

            } catch (error) {
                console.error("Erro na autenticação:", error);
                mostrarAcessoNegado("Ocorreu um erro ao verificar sua conta. Tente novamente mais tarde.");
            }
        }

        // Função que lê todos os membros do AppScript e verifica acesso
        async function verificarSeEIns(nick) {
            // A URL exata que você passou
            const urlAppScript = 'https://script.google.com/macros/s/AKfycbzhJdbeZfxkHgh3cQrK_YlhBCuhZyLhM_9jYkAnCPmbz-aYpv7845740KySuhjTzdIb/exec';
            
            try {
                // Faz o download do JSON
                const resposta = await fetch(urlAppScript);
                const listaMembros = await resposta.json();
                
                // Procura o membro na lista (ignorando maiúsculas/minúsculas para evitar erros)
                const membroEncontrado = listaMembros.find(
                    membro => membro.nick.toLowerCase() === nick.toLowerCase()
                );
                
                if (membroEncontrado) {
                    // Verifica se no JSON ele tem "SIM" no adminstore
                    const isAdmin = membroEncontrado.adminstore === "SIM";
                    
                    return { valido: true, isAdmin: isAdmin, dados: membroEncontrado };
                } else {
                    return { valido: false, isAdmin: false, dados: null };
                }
            } catch (erro) {
                console.error("Erro ao ler dados do Apps Script:", erro);
                return { valido: false, isAdmin: false, dados: null };
            }
        }

        // ═══════════════════════════════════════════════════
        // CONEXÃO COM SUPABASE (Onde salvamos pontos e histórico)
        // ═══════════════════════════════════════════════════
        async function carregarPerfilNoSupabase(nickForum, roleAppScript) {
            // Tenta buscar o perfil do usuário na tabela 'profiles' do Supabase
            const { data: perfilExistente, error } = await db
                .from("profiles")
                .select("*")
                .ilike("nickname", nickForum)
                .single();

            // Se o erro for PGRST116, significa que o usuário é novo e não tem registro ainda
            if (error && error.code === "PGRST116") {
                console.log("Novo usuário detectado, criando no Supabase...");
                
                // Como não usamos mais a auth nativa do Supabase, precisamos gerar um ID pra ele
                // Você pode usar o próprio nick como ID ou gerar um aleatório se sua tabela for UUID
                const { data: novoPerfil, error: erroCriacao } = await db.from("profiles").insert({
                    id: crypto.randomUUID(), // Gera um ID único se a tabela pedir UUID
                    nickname: nickForum,
                    habbo_user: nickForum, // O avatar puxa desse campo
                    role: roleAppScript,   // "admin" ou "user"
                    points: 0              // Começa com 0 pontos
                }).select().single();

                if (erroCriacao) {
                    console.error("Erro ao salvar no Supabase:", erroCriacao);
                    mostrarToast("Erro", "Falha ao conectar ao banco de dados.", "error");
                    return;
                }
                
                currentProfile = novoPerfil;
            
            } else if (error) {
                console.error("Erro inesperado no Supabase:", error);
                mostrarToast("Erro", "O banco de dados (Supabase) está indisponível.", "error");
                return;
            
            } else {
                // O perfil já existe no Supabase!
                currentProfile = perfilExistente;
                
                // BÔNUS: Se o cargo dele mudou no AppScript (virou admin ou perdeu admin), atualiza no Supabase
                if (currentProfile.role !== roleAppScript) {
                    const { data: perfilAtualizado } = await db.from("profiles")
                        .update({ role: roleAppScript })
                        .eq("id", currentProfile.id)
                        .select().single();
                        
                    if (perfilAtualizado) currentProfile = perfilAtualizado;
                }
            }

            // --- A PARTIR DAQUI A SESSÃO ESTÁ 100% PRONTA E CONECTADA NO SUPABASE ---
            atualizarUI();

            // Libera as abas de admin se o usuário for administrador ("SIM" no JSON)
            if (currentProfile.role === "admin") {
                document.getElementById("adminNavSection").style.display = "block";
                carregarDadosAdmin();
            }

            // Puxa histórico de ovos e resgates
            carregarDados();
        }

        // Função do Endpoint do fórum (Ajuste a URL para a API do seu fórum)
        async function obterNickDoForum() {
            // --- PARA TESTES MANTENHA A LINHA ABAIXO DESCOMENTADA ---
            // return "Sliker244"; // Sliker244 tem adminstore="SIM" no seu JSON
            // return "isabellaju97"; // isabellaju97 é usuária normal
            // return "Joaozinho"; // Joaozinho será bloqueado pois não está no JSON

            // --- QUANDO FOR PARA PRODUÇÃO, USE ESSE BLOCO: ---
            
            try {
                const urlDoForum = 'https://SEU_FORUM.com.br/api_user.php'; 
                const resposta = await fetch(urlDoForum, { method: 'GET', credentials: 'include' });
                const dados = await resposta.json();
                return (dados.logado && dados.nickname) ? dados.nickname : null;
            } catch (erro) {
                return null;
            }
            
        }

        function mostrarAcessoNegado(mensagem) {
            if (document.getElementById("loginModal")) document.getElementById("loginModal").remove();
            
            const overlay = document.createElement("div");
            overlay.id = "loginModal";
            overlay.className = "modal-overlay active";
            overlay.innerHTML = `
                <div class="modal" style="max-width:400px; text-align: center; border-top: 4px solid var(--danger);">
                    <div class="modal-header" style="justify-content: center; border-bottom: none; padding-top: 24px;">
                        <h3 class="modal-title" style="color: var(--danger); font-size: 20px;">
                            <i class="fa-solid fa-lock"></i> Acesso Restrito
                        </h3>
                    </div>
                    <div class="modal-body">
                        <p style="font-size:14px;color:var(--text-secondary);margin-bottom:24px;">
                            ${mensagem}
                        </p>
                        <button onclick="window.location.reload()" class="btn btn-secondary" style="width:100%; margin-bottom: 8px;">
                            <i class="fa-solid fa-rotate-right"></i> Tentar Novamente
                        </button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
        }

        // ═══════════════════════════════════════════════════
        // PERFIL DO USUÁRIO
        // ═══════════════════════════════════════════════════
        async function carregarPerfil() {
            const { data, error } = await db
                .from("profiles")
                .select("*")
                .eq("id", currentUser.id)
                .single();

            if (error && error.code === "PGRST116") {
                // Perfil ainda não existe — pede nickname
                abrirNicknameModal();
                return;
            }
            if (error) { console.error(error); return; }

            currentProfile = data;
            atualizarUI();

            // Mostra seção admin se for admin
            if (currentProfile.role === "admin") {
                document.getElementById("adminNavSection").style.display = "block";
                carregarDadosAdmin();
            }

            carregarDados();
        }

        async function salvarApelido(event) {
            event.preventDefault();
            const nickname = document.getElementById("nicknameInput").value.trim();
            if (!nickname) return;

            // Verifica se o nick Habbo existe na lista de membros
            // (opcional — remove if check se quiser abrir para não-membros)
            const { data: membro } = await db
                .from("habbo_members_cache")
                .select("habbo_nick, avatar_url")
                .ilike("habbo_nick", nickname)
                .single();

            const { data, error } = await db.from("profiles").insert({
                id:          currentUser.id,
                nickname:    nickname,
                habbo_user:  membro?.habbo_nick || null,
            }).select().single();

            if (error) {
                mostrarToast("Erro", "Não foi possível salvar o apelido.", "error");
                console.error(error);
                return;
            }

            currentProfile = data;
            fecharNicknameModal();
            atualizarUI();
            carregarDados();
        }

        function abrirNicknameModal() {
            document.getElementById("nicknameModal").classList.add("active");
        }
        function fecharNicknameModal() {
            document.getElementById("nicknameModal").classList.remove("active");
        }

        // ═══════════════════════════════════════════════════
        // ATUALIZAÇÃO DA UI
        // ═══════════════════════════════════════════════════
        function atualizarUI() {
            if (!currentProfile) return;
            const pts = currentProfile.points || 0;

            // Header
            document.getElementById("userDisplayName").textContent = currentProfile.nickname;
            document.getElementById("userDisplayRole").textContent =
                currentProfile.role === "admin" ? "🛡️ Administrador" : "🥚 Caçador";
            document.getElementById("userBadge").style.display = "flex";

            // Avatar Habbo
            if (currentProfile.habbo_user) {
                const avatarUrl = `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(currentProfile.habbo_user)}&action=std&size=l`;
                const avatarEl  = document.getElementById("userAvatar");
                avatarEl.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.textContent='🐰'">`;
            }

            // Stats
            document.getElementById("userPoints").textContent        = pts;
            document.getElementById("saldoPontosLoja").textContent  = pts;
            document.getElementById("meusPontosTotal").textContent  = pts;

            // Mobile
            document.getElementById("mobileUserName").textContent = currentProfile.nickname;
            document.getElementById("mobileUserRole").textContent =
                currentProfile.role === "admin" ? "Administrador" : "Caçador";
            document.getElementById("mobileProfile").style.display = "block";
        }

        // ═══════════════════════════════════════════════════
        // CARREGAMENTO PRINCIPAL DE DADOS
        // ═══════════════════════════════════════════════════
        async function carregarDados() {
            await Promise.all([
                carregarMeusResgates(),
                carregarPremios(),
                carregarRanking(),
            ]);
        }

        // ═══════════════════════════════════════════════════
        // GUIA DOS OVOS (estático)
        // ═══════════════════════════════════════════════════
        function renderGuiaOvos() {
            const lista = document.getElementById("guiaOvosLista");
            lista.innerHTML = Object.entries(TIPOS_OVO).map(([tipo, info]) => `
                <div class="guia-item ${info.classe}">
                    <div class="guia-header">
                        <div class="guia-emoji">${info.emoji}</div>
                        <div class="guia-titulo">
                            <div class="guia-nome ${tipo === 'coelhao' ? '' : ''}" style="${tipo !== 'coelhao' ? `color:var(--ovo-${tipo})` : ''}">${info.nome}</div>
                            <div class="guia-quantidade">${info.maxUsos}</div>
                        </div>
                    </div>
                    <div class="guia-recompensa">
                        <span class="guia-pontos">⭐ ${info.pontos} pontos</span>
                    </div>
                    <div class="guia-desc">${info.desc}</div>
                    <div class="guia-limites"><i class="fa-solid fa-circle-info"></i> Máximo de usos: ${info.maxUsos}</div>
                </div>
            `).join("");
        }

        // ═══════════════════════════════════════════════════
        // RESGATAR CÓDIGO — fluxo de 2 passos
        // Passo 1: verificar (RPC server-side)
        // Passo 2: enviar comprovação (INSERT em egg_redemptions)
        // ═══════════════════════════════════════════════════
        async function iniciarResgateCodigo() {
            const codigo = document.getElementById("codigoInput").value.trim().toUpperCase();
            if (!codigo) { mostrarToast("Atenção", "Digite um código.", "error"); return; }
            if (!currentProfile) { mostrarToast("Atenção", "Faça login primeiro.", "error"); return; }

            // Chama RPC server-side — não expõe lógica de negócio ao cliente
            const { data, error } = await db.rpc("verify_egg_code", { p_code: codigo });

            if (error) {
                mostrarToast("Erro", error.message, "error");
                return;
            }
            if (!data.ok) {
                mostrarToast("Código inválido", data.error, "error");
                return;
            }

            // Guarda o id do código para usar no passo 2
            pendingCodeId = data.code_id;

            // Abre modal de comprovação
            document.getElementById("comprovacaoCodigo").textContent = codigo;
            document.getElementById("comprovacaoInfo").innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;">
                    <span style="font-size:32px;">${TIPOS_OVO[data.type]?.emoji || "🥚"}</span>
                    <div>
                        <strong>${TIPOS_OVO[data.type]?.nome || data.type}</strong><br>
                        <span style="color:var(--gold-dark);font-weight:700;">+${data.points} pontos (após aprovação)</span>
                    </div>
                </div>`;
            document.getElementById("comprovacaoModal").classList.add("active");
        }

        async function confirmarComprovacao(event) {
            event.preventDefault();
            if (!pendingCodeId) return;

            const proofUrl = document.getElementById("comprovacaoLink").value.trim();
            const desc     = document.getElementById("comprovacaoDesc").value.trim();

            // Validação básica de URL
            if (!proofUrl.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i)) {
                mostrarToast("URL inválida", "O link deve apontar para uma imagem (png, jpg, gif...).", "error");
                return;
            }

            const { error } = await db.from("egg_redemptions").insert({
                user_id:     currentProfile.id,
                code_id:     pendingCodeId,
                proof_url:   proofUrl,
                description: desc,
                // status fica 'pendente' por default — o admin aprova
            });

            if (error) {
                mostrarToast("Erro", error.message || "Não foi possível enviar a comprovação.", "error");
                return;
            }

            fecharComprovacaoModal();
            pendingCodeId = null;
            document.getElementById("codigoInput").value = "";
            mostrarToast("Enviado!", "Comprovação enviada para aprovação. Aguarde o admin revisar.", "success");
            carregarMeusResgates();
        }

        function fecharComprovacaoModal() {
            document.getElementById("comprovacaoModal").classList.remove("active");
            document.getElementById("formComprovacao").reset();
            document.getElementById("linkPreview").style.display = "none";
        }

        // Preview de imagem no modal de comprovação
        document.addEventListener("DOMContentLoaded", () => {
            document.getElementById("comprovacaoLink")?.addEventListener("input", function () {
                const url = this.value.trim();
                const preview = document.getElementById("linkPreview");
                const img     = document.getElementById("previewImageLink");
                if (url.match(/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp)/i)) {
                    img.src = url;
                    preview.style.display = "block";
                } else {
                    preview.style.display = "none";
                }
            });
        });

        // ═══════════════════════════════════════════════════
        // MEUS RESGATES
        // ═══════════════════════════════════════════════════
        async function carregarMeusResgates() {
            if (!currentProfile) return;

            const { data: resgates, error } = await db
                .from("egg_redemptions")
                .select(`
                    id, status, points_awarded, reject_reason, created_at,
                    egg_codes ( type, points )
                `)
                .eq("user_id", currentProfile.id)
                .order("created_at", { ascending: false });

            if (error) { console.error(error); return; }

            const totalOvos    = resgates?.filter(r => r.status === "aprovado").length || 0;
            const totalPremios = 0; // será contado abaixo

            document.getElementById("userTotalOvos").textContent  = totalOvos;
            document.getElementById("meusOvosTotal").textContent  = totalOvos;

            const renderResgate = (r) => {
                const tipo    = r.egg_codes?.type || "comum";
                const info    = TIPOS_OVO[tipo] || TIPOS_OVO.comum;
                const statusLabel = { aprovado: "Aprovado", pendente: "Pendente", rejeitado: "Rejeitado" }[r.status];
                return `
                    <div class="resgate-card ${r.status}">
                        <div class="resgate-emoji">${info.emoji}</div>
                        <div class="resgate-info">
                            <h4>${info.nome}</h4>
                            <p>${new Date(r.created_at).toLocaleDateString("pt-BR")}</p>
                            <span class="resgate-status ${r.status}">${statusLabel}</span>
                            ${r.reject_reason ? `<p style="color:var(--danger);font-size:11px;margin-top:4px;">❌ ${r.reject_reason}</p>` : ""}
                        </div>
                        <div class="resgate-pontos">
                            <div class="pontos ${r.status}">
                                ${r.status === "aprovado" ? `+${r.points_awarded}` : r.status === "pendente" ? "?" : "—"}
                            </div>
                            <div style="font-size:10px;color:var(--text-tertiary);">pts</div>
                        </div>
                    </div>`;
            };

            const html = resgates?.length
                ? resgates.map(renderResgate).join("")
                : `<div class="empty-state"><div style="font-size:48px;">🧺</div><h3>Nenhum resgate ainda</h3><p>Encontre ovos e resgate os códigos!</p></div>`;

            document.getElementById("meuHistoricoCompleto").innerHTML = html;
            // Mostra apenas os 3 mais recentes na aba "Resgatar"
            const ultimos = resgates?.slice(0, 3);
            document.getElementById("meusUltimosResgates").innerHTML = ultimos?.length
                ? ultimos.map(renderResgate).join("")
                : `<div class="empty-state"><div style="font-size:48px;">🧺</div><h3>Sua cesta está vazia</h3><p>Encontre ovos para preenchê-la!</p></div>`;
        }

        // ═══════════════════════════════════════════════════
        // PRÊMIOS
        // ═══════════════════════════════════════════════════
        async function carregarPremios() {
            const { data: premios, error } = await db
                .from("prizes")
                .select("*")
                .eq("active", true)
                .order("cost_points");

            if (error) { console.error(error); return; }

            const total = premios?.length || 0;
            document.getElementById("totalPremios").textContent = `${total} prêmio${total !== 1 ? "s" : ""}`;

            const categorias = ["comum", "incomum", "raro", "epico", "lendario"];
            categorias.forEach(cat => {
                const lista = premios?.filter(p => p.category === cat) || [];
                document.getElementById(`premios${cat.charAt(0).toUpperCase() + cat.slice(1)}`).innerHTML =
                    lista.length
                        ? lista.map(renderPremioCard).join("")
                        : `<p style="color:var(--text-tertiary);font-size:13px;">Nenhum prêmio nesta categoria.</p>`;
            });
        }

        function renderPremioCard(p) {
            const userPts  = currentProfile?.points || 0;
            const podePagar = userPts >= p.cost_points;
            const semEstoque = p.stock <= 0;
            return `
                <div class="premio-card ${p.category}">
                    <span class="premio-raridade">${p.category.toUpperCase()}</span>
                    <div class="premio-icon">
                        <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}" onerror="this.src=''">
                    </div>
                    <div class="premio-nome">${escapeHtml(p.name)}</div>
                    <div class="premio-desc">${escapeHtml(p.description || "")}</div>
                    <div style="text-align:center;margin-bottom:12px;">
                        <span style="font-size:18px;font-weight:800;color:var(--gold-dark);">⭐ ${p.cost_points}</span>
                        <span style="font-size:11px;color:var(--text-tertiary);"> pts</span>
                    </div>
                    <div style="text-align:center;margin-bottom:12px;">
                        <span style="font-size:12px;color:${semEstoque ? 'var(--danger)' : 'var(--success)'};">
                            ${semEstoque ? "❌ Sem estoque" : `✅ ${p.stock} em estoque`}
                        </span>
                    </div>
                    <button class="btn ${!podePagar || semEstoque ? 'btn-secondary' : 'btn-primary'} btn-sm"
                        style="width:100%;"
                        ${!podePagar || semEstoque ? "disabled" : ""}
                        onclick="resgatar_premio('${p.id}', '${escapeHtml(p.name)}', ${p.cost_points})">
                        ${semEstoque ? "Esgotado" : !podePagar ? `Faltam ${p.cost_points - userPts} pts` : "Resgatar"}
                    </button>
                </div>`;
        }

        async function resgatar_premio(prizeId, nomePremio, custo) {
            if (!currentProfile) return;
            if (currentProfile.points < custo) {
                mostrarToast("Pontos insuficientes", `Você precisa de ${custo} pts.`, "error");
                return;
            }
            if (!confirm(`Confirma resgatar "${nomePremio}" por ${custo} pontos?`)) return;

            // INSERT dispara o trigger handle_prize_redemption que valida e debita pontos
            const { error } = await db.from("prize_redemptions").insert({
                user_id:  currentProfile.id,
                prize_id: prizeId,
                points_spent: custo, // o trigger valida este valor server-side
            });

            if (error) {
                mostrarToast("Erro", error.message, "error");
                return;
            }

            mostrarToast("Resgatado!", `"${nomePremio}" resgatado com sucesso!`, "success");

            // Recarrega perfil para atualizar pontos
            await carregarPerfil();
            carregarPremios();
        }

        // ═══════════════════════════════════════════════════
        // RANKING
        // ═══════════════════════════════════════════════════
        async function carregarRanking() {
            const { data, error } = await db
                .from("ranking_view")
                .select("*")
                .limit(50);

            if (error) { console.error(error); return; }

            const sorted = rankingMode === "ovos"
                ? [...(data || [])].sort((a, b) => b.total_ovos - a.total_ovos)
                : data || [];

            renderPodium(sorted.slice(0, 3));
            renderRankingLista(sorted);
        }

        function alternarRanking(modo) {
            rankingMode = modo;
            document.getElementById("btnRankPontos").classList.toggle("active", modo === "pontos");
            document.getElementById("btnRankOvos").classList.toggle("active",   modo === "ovos");
            carregarRanking();
        }

        function renderPodium(top3) {
            const posOrder = [1, 0, 2]; // posição visual: 2º, 1º, 3º
            const medals   = ["🥇", "🥈", "🥉"];
            const posClass = ["pos-2", "pos-1", "pos-3"];
            const container = document.getElementById("podiumTop3");

            if (!top3.length) {
                container.innerHTML = `<div style="text-align:center;color:var(--text-tertiary);">Nenhum caçador ainda</div>`;
                return;
            }

            container.innerHTML = posOrder.map((idx, visual) => {
                const user = top3[idx];
                if (!user) return "";
                const avatarUrl = user.habbo_user
                    ? `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(user.habbo_user)}&action=std&size=l`
                    : null;

                return `
                    <div class="podium-item ${posClass[visual]}">
                        <div class="podium-avatar-wrapper">
                            <div class="podium-badge">${medals[idx]}</div>
                            <div class="podium-avatar-container">
                                ${avatarUrl
                                    ? `<img src="${avatarUrl}" alt="${escapeHtml(user.nickname)}" onerror="this.parentElement.innerHTML='<div class=podium-avatar-placeholder>${user.nickname.charAt(0).toUpperCase()}</div>'">`
                                    : `<div class="podium-avatar-placeholder">${user.nickname.charAt(0).toUpperCase()}</div>`}
                            </div>
                        </div>
                        <div class="podium-base">
                            <div class="podium-info">
                                <div class="podium-nome">${escapeHtml(user.nickname)}</div>
                                <div class="podium-stats">
                                    <div class="podium-pontos">⭐ ${user.points}</div>
                                    <div class="podium-label">PONTOS</div>
                                </div>
                            </div>
                            <div class="podium-rank-number">${idx + 1}</div>
                        </div>
                    </div>`;
            }).join("");
        }

        function renderRankingLista(users) {
            const container = document.getElementById("rankingCompleto");
            if (!users.length) {
                container.innerHTML = `<div class="empty-state"><div style="font-size:48px;">🏆</div><h3>Sem dados ainda</h3></div>`;
                return;
            }

            container.innerHTML = users.map((u, i) => {
                const pos = i + 1;
                const posClass = pos === 1 ? "top-1" : pos === 2 ? "top-2" : pos === 3 ? "top-3" : "normal";
                const isMe     = u.id === currentProfile?.id;
                const avatarUrl = u.habbo_user
                    ? `https://www.habbo.com.br/habbo-imaging/avatarimage?user=${encodeURIComponent(u.habbo_user)}&action=std&size=l`
                    : null;

                return `
                    <div class="ranking-item ${isMe ? "destaque" : ""}" data-pos="${pos}"
                         style="animation-delay:${i * 0.05}s">
                        <div class="ranking-pos ${posClass}">
                            ${pos <= 3 ? ["🥇","🥈","🥉"][pos-1] : pos}
                        </div>
                        <div class="ranking-avatar-habbo">
                            ${avatarUrl
                                ? `<img src="${avatarUrl}" alt="${escapeHtml(u.nickname)}" onerror="this.parentElement.innerHTML='<div class=ranking-avatar-placeholder>${u.nickname.charAt(0).toUpperCase()}</div>'">`
                                : `<div class="ranking-avatar-placeholder">${u.nickname.charAt(0).toUpperCase()}</div>`}
                        </div>
                        <div class="ranking-info">
                            <div class="ranking-nome">
                                ${escapeHtml(u.nickname)}
                                ${isMe ? '<span class="ranking-badge">Você</span>' : ""}
                            </div>
                            <div class="ranking-stats-row">
                                <span class="ranking-stat pontos"><i class="fa-solid fa-coins"></i> ${u.points} pts</span>
                                <span class="ranking-stat ovos"><i class="fa-solid fa-egg"></i> ${u.total_ovos} ovos</span>
                            </div>
                        </div>
                        <div class="ranking-valor">
                            <div class="ranking-numero">${rankingMode === "ovos" ? u.total_ovos : u.points}</div>
                            <div class="ranking-label">${rankingMode === "ovos" ? "ovos" : "pontos"}</div>
                        </div>
                    </div>`;
            }).join("");
        }

        function setupRealtimeRanking() {
            db.channel("ranking-updates")
                .on("postgres_changes",
                    { event: "*", schema: "public", table: "profiles" },
                    () => carregarRanking()
                )
                .subscribe();
        }

        // ═══════════════════════════════════════════════════
        // ADMIN — só executado se role = 'admin'
        // ═══════════════════════════════════════════════════
        async function carregarDadosAdmin() {
            if (currentProfile?.role !== "admin") return;

            const [
                { count: totalUsers },
                { count: totalCodes },
                { count: activeCodes },
                { count: pending },
            ] = await Promise.all([
                db.from("profiles").select("*", { count: "exact", head: true }),
                db.from("egg_codes").select("*", { count: "exact", head: true }),
                db.from("egg_codes").select("*", { count: "exact", head: true }).lt("uses_count", db.raw("max_uses")),
                db.from("egg_redemptions").select("*", { count: "exact", head: true }).eq("status", "pendente"),
            ]);

            document.getElementById("statTotalUsers").textContent = totalUsers || 0;
            document.getElementById("statTotalCodes").textContent = totalCodes || 0;
            document.getElementById("statActiveCodes").textContent = activeCodes || 0;
            document.getElementById("statPending").textContent     = pending || 0;

            carregarAprovacoes();
            carregarCodigos();
            carregarPremiosAdmin();
        }

        async function carregarAprovacoes() {
            const { data, error } = await db
                .from("egg_redemptions")
                .select(`
                    id, proof_url, description, status, created_at,
                    users:profiles ( nickname, habbo_user ),
                    egg_codes ( code, type, points )
                `)
                .eq("status", "pendente")
                .order("created_at");

            if (error) { console.error(error); return; }

            if (!data?.length) {
                document.getElementById("listaAprovacoes").innerHTML =
                    `<div class="empty-state"><i class="fa-solid fa-check-circle" style="font-size:48px;color:var(--success);"></i><h3>Nenhum resgate pendente</h3></div>`;
                return;
            }

            document.getElementById("listaAprovacoes").innerHTML = data.map(r => {
                const tipo = r.egg_codes?.type || "comum";
                // Lidar com o JOIN de users:profiles
                const nickname = r.users ? r.users.nickname : "?"; 
                return `
                    <div class="resgate-card pendente" style="margin-bottom:12px;">
                        <div class="resgate-emoji">${TIPOS_OVO[tipo]?.emoji || "🥚"}</div>
                        <div class="resgate-info" style="flex:1;">
                            <h4>${escapeHtml(nickname)} — ${TIPOS_OVO[tipo]?.nome || tipo}</h4>
                            <p>Código: <strong>${escapeHtml(r.egg_codes?.code || "?")}</strong> · +${r.egg_codes?.points} pts</p>
                            <p style="font-size:11px;color:var(--text-tertiary);">${new Date(r.created_at).toLocaleString("pt-BR")}</p>
                        </div>
                        <div class="action-btns">
                            <button class="btn-icon view" title="Ver comprovação" onclick="verComprovacao('${r.id}','${escapeHtml(r.proof_url)}','${escapeHtml(r.description)}')">
                                <i class="fa-solid fa-eye"></i>
                            </button>
                            <button class="btn-icon approve" title="Aprovar" onclick="aprovarResgate('${r.id}')">
                                <i class="fa-solid fa-check"></i>
                            </button>
                            <button class="btn-icon reject" title="Rejeitar" onclick="abrirRejectModal('${r.id}')">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>`;
            }).join("");
        }

        async function aprovarResgate(redemptionId) {
            if (!confirm("Confirmar aprovação deste resgate?")) return;

            // Update de status — o trigger handle_egg_redemption_approval faz o resto
            const { error } = await db
                .from("egg_redemptions")
                .update({ status: "aprovado", reviewed_by: currentProfile.id })
                .eq("id", redemptionId)
                .eq("status", "pendente"); // garante que não aprova algo já processado

            if (error) { mostrarToast("Erro", error.message, "error"); return; }

            mostrarToast("Aprovado!", "Resgate aprovado e pontos creditados.", "success");
            carregarAprovacoes();
            carregarDadosAdmin();
        }

        async function confirmarRejeicao(event) {
            event.preventDefault();
            const id     = document.getElementById("rejectRedemptionId").value;
            const reason = document.getElementById("rejectReason").value.trim();

            const { error } = await db
                .from("egg_redemptions")
                .update({ status: "rejeitado", reject_reason: reason, reviewed_by: currentProfile.id })
                .eq("id", id)
                .eq("status", "pendente");

            if (error) { mostrarToast("Erro", error.message, "error"); return; }

            fecharRejectModal();
            mostrarToast("Rejeitado", "Resgate rejeitado.", "success");
            carregarAprovacoes();
        }

        function abrirRejectModal(id) {
            document.getElementById("rejectRedemptionId").value = id;
            document.getElementById("rejectModal").classList.add("active");
        }
        function fecharRejectModal() {
            document.getElementById("rejectModal").classList.remove("active");
            document.getElementById("formRejeicao").reset();
        }

        function verComprovacao(id, proofUrl, desc) {
            document.getElementById("viewProofContent").innerHTML = `
                <div style="margin-bottom:16px;">
                    <img src="${escapeHtml(proofUrl)}" style="max-width:100%;border-radius:8px;border:1px solid var(--border);" alt="Comprovação">
                </div>
                <p><strong>Descrição:</strong><br>${escapeHtml(desc)}</p>
                <div style="display:flex;gap:12px;margin-top:16px;">
                    <button class="btn btn-success" style="flex:1;" onclick="aprovarResgate('${id}');fecharViewProofModal();">
                        <i class="fa-solid fa-check"></i> Aprovar
                    </button>
                    <button class="btn btn-danger" style="flex:1;" onclick="fecharViewProofModal();abrirRejectModal('${id}')">
                        <i class="fa-solid fa-xmark"></i> Rejeitar
                    </button>
                </div>`;
            document.getElementById("viewProofModal").classList.add("active");
        }
        function fecharViewProofModal() {
            document.getElementById("viewProofModal").classList.remove("active");
        }

        // ADMIN — Gerar Códigos
        function abrirCodigoModal() { document.getElementById("codigoModal").classList.add("active"); }
        function fecharCodigoModal() {
            document.getElementById("codigoModal").classList.remove("active");
            document.getElementById("formCodigo").reset();
        }

        async function gerarCodigos(event) {
            event.preventDefault();
            if (currentProfile?.role !== "admin") return;

            const tipo        = document.getElementById("codigoTipo").value;
            const quantidade  = parseInt(document.getElementById("codigoQuantidade").value);
            const localHint   = document.getElementById("codigoLocal").value.trim();
            const tipoInfo    = TIPOS_OVO[tipo];

            const novos = Array.from({ length: quantidade }, () => ({
                code:          gerarCodigoAleatorio(tipo),
                type:          tipo,
                points:        tipoInfo.pontos,
                max_uses:      ["comum"].includes(tipo) ? 9999 : ["incomum"].includes(tipo) ? 10 : ["raro"].includes(tipo) ? 5 : 1,
                location_hint: localHint || null,
                created_by:    currentProfile.id,
            }));

            const { data, error } = await db.from("egg_codes").insert(novos).select();
            if (error) { mostrarToast("Erro", error.message, "error"); return; }

            fecharCodigoModal();
            mostrarToast("Criado!", `${quantidade} código(s) gerado(s) com sucesso.`, "success");
            carregarCodigos();
        }

        function gerarCodigoAleatorio(tipo) {
            const prefix  = { comum: "SRC-C", incomum: "SRC-I", raro: "SRC-R", epico: "SRC-E", lendario: "SRC-L", coelhao: "SRC-X" }[tipo] || "SRC-O";
            const chars   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
            const part    = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
            return `${prefix}-${part}`;
        }

        async function carregarCodigos() {
            const tipoFiltro   = document.getElementById("filtroTipoOvo")?.value || "";
            const statusFiltro = document.getElementById("filtroStatusCode")?.value || "";

            let query = db.from("egg_codes")
                .select("*, users:profiles!created_by(nickname)")
                .order("created_at", { ascending: false });

            if (tipoFiltro)    query = query.eq("type", tipoFiltro);
            if (statusFiltro === "active") query = query.filter("uses_count", "lt", "max_uses");
            if (statusFiltro === "used")   query = query.filter("uses_count", "gte", "max_uses");

            const { data, error } = await query;
            if (error) { console.error(error); return; }

            document.getElementById("corpoTabelaCodigos").innerHTML = (data || []).map(c => {
                const esgotado = c.uses_count >= c.max_uses;
                const nickname = c.users ? c.users.nickname : "—";
                return `
                    <tr>
                        <td><span class="code-badge ${c.type}">${escapeHtml(c.code)}</span></td>
                        <td>${TIPOS_OVO[c.type]?.emoji || ""} ${c.type}</td>
                        <td><span class="status-pill ${esgotado ? 'used' : 'active'}">${esgotado ? "Esgotado" : "Ativo"} (${c.uses_count}/${c.max_uses})</span></td>
                        <td>${escapeHtml(nickname)}</td>
                        <td>
                            <div class="action-btns">
                                <button class="btn-icon copy" title="Copiar código" onclick="navigator.clipboard.writeText('${c.code}').then(()=>mostrarToast('Copiado!','','success'))">
                                    <i class="fa-solid fa-copy"></i>
                                </button>
                            </div>
                        </td>
                    </tr>`;
            }).join("");
        }

        function filtrarCodigos() { carregarCodigos(); }

        // ADMIN — Prêmios
        function abrirPremioModal() { document.getElementById("premioModal").classList.add("active"); }
        function fecharPremioModal() {
            document.getElementById("premioModal").classList.remove("active");
            document.getElementById("formPremio").reset();
        }

        document.getElementById("premioImagem")?.addEventListener("input", function () {
            const url = this.value.trim();
            const preview = document.getElementById("premioPreview");
            const text    = document.getElementById("premioPreviewText");
            if (url.startsWith("https://i.imgur.com/")) {
                preview.src = url; preview.style.display = "block";
                text.style.display = "none";
            } else {
                preview.style.display = "none"; text.style.display = "block";
            }
        });

        async function salvarPremio(event) {
            event.preventDefault();
            if (currentProfile?.role !== "admin") return;

            const imageUrl = document.getElementById("premioImagem").value.trim();
            if (!imageUrl.startsWith("https://i.imgur.com/")) {
                mostrarToast("URL inválida", "Use apenas links do Imgur (https://i.imgur.com/...).", "error");
                return;
            }

            const { error } = await db.from("prizes").insert({
                name:        document.getElementById("premioNome").value.trim(),
                category:    document.getElementById("premioCategoria").value,
                cost_points: parseInt(document.getElementById("premioCusto").value),
                image_url:   imageUrl,
                stock:       parseInt(document.getElementById("premioEstoque").value),
                description: document.getElementById("premioDescricao").value.trim(),
            });

            if (error) { mostrarToast("Erro", error.message, "error"); return; }

            fecharPremioModal();
            mostrarToast("Salvo!", "Prêmio adicionado.", "success");
            carregarPremiosAdmin();
            carregarPremios();
        }

        async function carregarPremiosAdmin() {
            const { data, error } = await db.from("prizes").select("*").order("created_at", { ascending: false });
            if (error) { console.error(error); return; }

            document.getElementById("corpoTabelaPremios").innerHTML = (data || []).map(p => `
                <tr>
                    <td><img src="${escapeHtml(p.image_url)}" class="prize-image-preview" alt="${escapeHtml(p.name)}"></td>
                    <td>${escapeHtml(p.name)}</td>
                    <td>${p.category}</td>
                    <td>⭐ ${p.cost_points}</td>
                    <td>${p.stock}</td>
                    <td>${p.total_sold}</td>
                    <td>
                        <div class="action-btns">
                            <button class="btn-icon view" onclick="abrirEditPremio('${p.id}')"><i class="fa-solid fa-pen"></i></button>
                        </div>
                    </td>
                </tr>`).join("");
        }

        async function abrirEditPremio(id) {
            const { data, error } = await db.from("prizes").select("*").eq("id", id).single();
            if (error || !data) return;
            document.getElementById("editPremioId").value       = data.id;
            document.getElementById("editPremioNome").value     = data.name;
            document.getElementById("editPremioImagem").value   = data.image_url;
            document.getElementById("editPremioEstoque").value  = data.stock;
            document.getElementById("editPremioCusto").value    = data.cost_points;
            document.getElementById("editPremioDescricao").value = data.description || "";
            document.getElementById("editPremioPreview").src    = data.image_url;
            document.getElementById("editPremioPreview").style.display = "block";
            document.getElementById("editPremioModal").classList.add("active");
        }

        function fecharEditPremioModal() {
            document.getElementById("editPremioModal").classList.remove("active");
        }

        async function salvarEdicaoPremio(event) {
            event.preventDefault();
            if (currentProfile?.role !== "admin") return;
            const id = document.getElementById("editPremioId").value;

            const { error } = await db.from("prizes").update({
                name:        document.getElementById("editPremioNome").value.trim(),
                image_url:   document.getElementById("editPremioImagem").value.trim(),
                stock:       parseInt(document.getElementById("editPremioEstoque").value),
                cost_points: parseInt(document.getElementById("editPremioCusto").value),
                description: document.getElementById("editPremioDescricao").value.trim(),
            }).eq("id", id);

            if (error) { mostrarToast("Erro", error.message, "error"); return; }

            fecharEditPremioModal();
            mostrarToast("Atualizado!", "Prêmio editado.", "success");
            carregarPremiosAdmin();
            carregarPremios();
        }

        // ═══════════════════════════════════════════════════
        // NAVEGAÇÃO
        // ═══════════════════════════════════════════════════
        function showSection(sectionId) {
            document.querySelectorAll(".section-content").forEach(el => el.classList.add("hidden"));
            document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
            document.getElementById(`section-${sectionId}`)?.classList.remove("hidden");
            document.querySelector(`[data-section="${sectionId}"]`)?.classList.add("active");

            // Carrega dados ao navegar
            if (sectionId === "ranking") carregarRanking();
            if (sectionId === "meus")    carregarMeusResgates();
            if (sectionId === "premios") carregarPremios();
            if (sectionId === "admin" && currentProfile?.role === "admin") carregarDadosAdmin();
        }

        function showAdminTab(tab) {
            document.querySelectorAll(".admin-section").forEach(el => el.classList.remove("active"));
            document.querySelectorAll(".admin-tab").forEach(el => el.classList.remove("active"));
            document.getElementById(`admin-${tab}`)?.classList.add("active");
            document.querySelector(`[data-tab="${tab}"]`)?.classList.add("active");
        }

        function toggleMobileMenu() {
            const nav     = document.getElementById("sidebarNav");
            const overlay = document.getElementById("sidebarOverlay");
            const btn     = document.getElementById("mobileMenuBtn");
            nav.classList.toggle("active");
            overlay.classList.toggle("active");
            btn.classList.toggle("active");
        }
        function closeMobileMenu() {
            document.getElementById("sidebarNav").classList.remove("active");
            document.getElementById("sidebarOverlay").classList.remove("active");
            document.getElementById("mobileMenuBtn").classList.remove("active");
        }

        // ═══════════════════════════════════════════════════
        // UTILS
        // ═══════════════════════════════════════════════════
        function mostrarToast(titulo, mensagem, tipo = "success") {
            const toast = document.getElementById("toast");
            const icon  = toast.querySelector(".toast-icon i");
            document.getElementById("toastTitle").textContent   = titulo;
            document.getElementById("toastMessage").textContent = mensagem;
            toast.className = `toast ${tipo} show`;
            icon.className  = tipo === "success" ? "fa-solid fa-check" : "fa-solid fa-xmark";
            setTimeout(() => toast.classList.remove("show"), 4000);
        }

        function fecharResultadoModal() {
            document.getElementById("resultadoModal").classList.remove("active");
        }

        // Escapa HTML para evitar XSS
        function escapeHtml(str) {
            if (typeof str !== "string") return "";
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
