import { expect, test } from "@playwright/test";

test("navigates through the demo dashboard", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Comentários que viram/ })).toBeVisible();
  await expect(page.getByRole("main").getByText("Modo demonstração", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /Nova automação/ }).first().click();
  await expect(page.getByRole("heading", { name: "Do comentário ao direct." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Aceitamos maiúsculas", { exact: false })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("shows responsive navigation on a small viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/automations");
  const navigation = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveCount(8);
  for (const link of await navigation.getByRole("link").all()) await expect(link).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Automações" })).toBeVisible();
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("keeps history actions and integration controls accessible on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/history");
  await expect(page.locator(".history-row").first()).toBeVisible();
  await expect(page.locator(".history-row").first().locator(".history-public")).toHaveAttribute("data-label", "Resposta pública");
  const retryButton = page.getByRole("button", { name: "Reenviar DM" }).first();
  await retryButton.scrollIntoViewIfNeeded();
  await expect(retryButton).toBeInViewport();
  await expect(retryButton).toHaveCSS("min-height", "48px");

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Contas do Instagram" })).toBeVisible();
  const connectionAction = page.locator(".connection-actions .button").first();
  await expect(connectionAction).toBeVisible();
  await connectionAction.scrollIntoViewIfNeeded();
  await expect(connectionAction).toBeInViewport();
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    actionRight: document.querySelector(".connection-actions .button")?.getBoundingClientRect().right ?? 0,
  }));
  expect(layout.document).toBeLessThanOrEqual(layout.viewport);
  expect(layout.actionRight).toBeLessThanOrEqual(layout.viewport);
});

test("keeps every main screen inside a compact viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of ["/dashboard", "/radar", "/studio", "/studio/new", "/studio/new?mode=ideas", "/novo-conteudo", "/connection-guide", "/automations", "/automations/new", "/history", "/settings"]) {
    await page.goto(route);
    if (route === "/radar") await page.getByText(/Ver \d+ evidências?/).first().click();
    const overflow = await page.evaluate(() => {
      const offenders = [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && (rect.left < -1 || rect.right > window.innerWidth + 1);
      });
      return { document: document.documentElement.scrollWidth, viewport: window.innerWidth, offenders: offenders.length };
    });
    expect(overflow.document, route).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.offenders, route).toBe(0);
  }
});

test("suggests automatic studio ideas from the connected account", async ({ page }) => {
  await page.goto("/studio/new?mode=ideas");
  await expect(page.getByRole("heading", { name: "Escolhe uma ideia pra virar campanha" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/não entrega Reels de terceiros/i)).toBeVisible();
  await page.locator(".studio-idea-card").first().click();
  await expect(page.getByLabel("Assunto do Reel")).not.toHaveValue("");
  await expect(page.getByRole("button", { name: "Gerar 3 ideias" })).toBeVisible();
});

test("creates a content package and copies the exact Instagram formatting", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3000" });
  await page.goto("/studio/new");
  await page.getByLabel("Nome interno").fill("Primeira automação com IA");
  await page.getByLabel("Assunto do Reel").fill('Mostrar que responder apenas "R$ X" quando alguém pergunta preço pode encerrar a conversa antes de a pessoa entender o serviço. Ensinar a explicar valor.');
  await page.getByRole("button", { name: "Gerar 3 ideias" }).click();
  await expect(page.locator(".studio-concept-card")).toHaveCount(3, { timeout: 15_000 });
  const firstConcept = page.locator(".studio-concept-card").first();
  await expect(firstConcept).toBeVisible();
  await expect(firstConcept.getByRole("heading")).toHaveText('Responder só "R$ X" quando alguém pergunta o preço pode encerrar a conversa antes que a pessoa entenda o valor do seu trabalho.');
  await expect(firstConcept).not.toContainText("faz mostrar");
  await expect(firstConcept.getByRole("button", { name: "Copiar" }).first()).toBeVisible();
  const chooseConcept = firstConcept.getByRole("button", { name: /Escolher e gerar pacote/ });
  await chooseConcept.scrollIntoViewIfNeeded();
  await expect(chooseConcept).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  await page.getByRole("button", { name: /Escolher e gerar pacote/ }).first().click();
  await expect(page.getByRole("heading", { name: "Três tamanhos, a mesma ideia" })).toBeVisible({ timeout: 15_000 });

  const exactCaption = "@hernando.ia\n\nPrimeiro bloco, curto e direto.\n\n1. Primeiro passo\n2. Segundo passo\n\nComente MAPA para receber.";
  const medium = page.locator('textarea[name="mediumCaption"]');
  await medium.fill(exactCaption);
  await medium.locator("xpath=..").getByRole("button", { name: "Copiar" }).click();
  await expect(medium.locator("xpath=..").getByRole("button", { name: "Copiado" })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(exactCaption);

  await expect(page.locator(".studio-deliverable-stats").getByText("5", { exact: true })).toBeVisible();
  await expect(page.locator(".studio-deliverable-stats").getByText("2", { exact: true })).toBeVisible();
  const materialUrl = await page.getByRole("link", { name: /Abrir página pública/ }).getAttribute("href");
  expect(materialUrl).toBeTruthy();
  // Keep the test on Playwright's configured origin. APP_ORIGIN can use a
  // different localhost alias in CI, which prevents Next dev hydration.
  await page.goto(new URL(materialUrl!, page.url()).pathname);
  await expect(page.getByText("EXECUÇÃO GUIADA", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passo 1 de 5" })).toBeVisible();
  await expect(page.locator(".quick-step")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Copiar este prompt" })).toHaveCount(0);
  await page.getByRole("button", { name: "Concluir e continuar" }).click();
  await expect(page.getByRole("heading", { name: "Passo 2 de 5" })).toBeVisible();
  const firstPrompt = page.locator(".quick-copy pre");
  await page.getByRole("button", { name: "Copiar este prompt" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await firstPrompt.innerText());
  for (let step = 2; step <= 5; step += 1) {
    await page.getByRole("button", { name: "Concluir e continuar" }).click();
    if (step < 5) await expect(page.getByRole("heading", { name: `Passo ${step + 1} de 5` })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Seu material está pronto para aplicar" })).toBeVisible();
  const aiResult = "Prompt final adaptado ao meu caso com três critérios e tabela de avaliação.";
  await page.locator(".material-result-box textarea").fill(aiResult);
  await page.reload();
  await expect(page.locator(".material-result-box textarea")).toHaveValue(aiResult);
  await expect(page.getByText("Preciso entender melhor antes de executar")).toHaveCount(0);
  await expect(page.locator(".material-step")).toHaveCount(0);
  await page.getByRole("button", { name: "Rever o passo a passo" }).click();
  await expect(page.getByRole("heading", { name: "Passo 1 de 5" })).toBeVisible();
  const materialWidth = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(materialWidth.document).toBeLessThanOrEqual(materialWidth.viewport);
});

test("keeps automation fields readable without iOS input zoom", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/automations/new");
  const fieldSizes = await page.locator("input, textarea, select").evaluateAll((fields) =>
    fields.map((field) => Number.parseFloat(getComputedStyle(field).fontSize)),
  );
  expect(fieldSizes.length).toBeGreaterThan(0);
  expect(fieldSizes.every((size) => size >= 16)).toBe(true);
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(360);
});

test("selects a Reel from the visual gallery", async ({ page }) => {
  await page.goto("/automations/new");
  const options = page.locator(".reel-option");
  await expect(options).toHaveCount(3);
  await options.nth(1).click();
  await expect(options.nth(1).getByRole("radio")).toBeChecked();
  await page.getByRole("textbox", { name: "Buscar Reel pela legenda" }).fill("Checklist");
  await expect(page.locator(".reel-option")).toHaveCount(1);
  await expect(page.getByText("1 de 3 Reels")).toBeVisible();
});

test("explores Radar evidence and opens a connected Studio project", async ({ page }) => {
  await page.goto("/radar");
  await expect(page.getByRole("heading", { name: /O que sua audiência/ })).toBeVisible();
  await expect(page.getByText("Caixa de oportunidades", { exact: true })).toBeVisible();
  await page.getByText(/Ver \d+ evidências?/).first().click();
  await expect(page.locator(".evidence-list blockquote").first()).toBeVisible();
  await page.getByRole("link", { name: /Criar no Estúdio/ }).first().click();
  await expect(page.getByRole("heading", { name: "Vamos encontrar o melhor ângulo." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Assunto do Reel")).not.toHaveValue("");
});

test("generates keyword and message variations for the selected Reel", async ({ page }) => {
  await page.goto("/automations/new");
  await page.locator(".reel-option").first().click();
  await page.getByLabel("Palavra-chave").fill("Material");
  await expect(page.locator(".keyword-variant").filter({ hasText: "material." })).toBeVisible();
  await expect(page.locator('input[name="keywordVariants"][value="materia"]').locator("..")).toBeVisible();
  await page.getByRole("button", { name: "Gerar sugestões" }).click();
  await expect(page.getByRole("button", { name: "Usar as 3 sugestões" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Usar as 3 sugestões" }).click();
  const publicReplies = page.locator('textarea[name="publicReplyVariants"]');
  await expect(publicReplies).toHaveCount(3);
  await expect(publicReplies.nth(0)).not.toHaveValue("");
  await expect(publicReplies.nth(1)).not.toHaveValue("");
  await expect(publicReplies.nth(2)).not.toHaveValue("");
});

test("follows the Instagram connection guide and persists progress", async ({ page }) => {
  await page.goto("/connection-guide");
  await expect(page.getByRole("heading", { name: /Um caminho só/ })).toBeVisible();
  await expect(page.getByText("Você instalou ou administra o Vortex?", { exact: true })).toBeVisible();
  await expect(page.getByText(/Você não precisa criar um app na Meta/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir criação de aplicativo" })).toHaveAttribute("href", "https://developers.facebook.com/apps/creation/");
  await expect(page.getByText("Gerenciar mensagens e conteúdo no Instagram", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "A página correta tem cinco blocos numerados" })).toBeVisible();
  await expect(page.getByText("Auxiliar de integração de API", { exact: true })).toBeVisible();
  await expect(page.getByText("instagram_business_basic", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Não use o App ID genérico/)).toBeVisible();
  await expect(page.getByText(/Não use "Gerar token" para conectar/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Crie seu META_WEBHOOK_VERIFY_TOKEN aqui" })).toBeVisible();
  await page.getByRole("button", { name: "Gerar token seguro" }).click();
  await expect(page.getByText("Seu token foi criado", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Copiar token:/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ligue comments e messages" })).toBeVisible();
  await expect(page.getByText("URL de callback", { exact: true })).toBeVisible();
  await expect(page.getByText("Valid OAuth Redirect URI", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Marcar como concluída" }).first().click();
  await expect(page.getByRole("button", { name: "Etapa concluída" }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Etapa concluída" }).first()).toBeVisible();
  await expect(page.getByText("1 de 8 etapas", { exact: true })).toBeVisible();
});

test("unknown tracking tokens never redirect", async ({ request }) => {
  const response = await request.get("/r/AAAAAAAAAAAAAAAAAAAAAA", { maxRedirects: 0 });
  expect(response.status()).toBe(404);
  const head = await request.head("/r/AAAAAAAAAAAAAAAAAAAAAA");
  expect(head.status()).toBe(204);
});
