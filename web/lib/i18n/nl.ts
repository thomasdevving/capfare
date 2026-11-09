import type { Dict } from "./en";

const eur = (c: number) => `€ ${(c / 100).toFixed(c % 100 ? 2 : 0).replace(".", ",")}`;

export const nl: Dict = {
  locale: "nl" as unknown as "en",
  htmlLang: "nl",
  meta: {
    title: "CapFare — zet de prijs van je vlucht vast",
    description: "Zet een maximumprijs vast op één specifieke vlucht, boek waar je wilt en krijg het verschil terug. Testnet-prototype op NEAR.",
  },
  nav: { how: "Zo werkt het", protection: "Bescherming", payout: "Jouw uitbetaling", faq: "Vragen", app: "Check een vlucht", switchTo: "English", switchHref: "/" },
  hero: {
    h1a: "Bescherm je vluchtprijs.",
    h1b: "Voor en na het boeken.",
    sub: "Zet vooraf een prijsplafond vast of bescherm je tegen een prijsdaling na het boeken. Voor één exacte vlucht, datum en tariefklasse, met een vooraf afgesproken eigen risico en uitbetalingslimiet.",
    ctaChrome: "Download de extensie",
    ctaCheck: "Check een vlucht",
    chromeNote: "Laad de Chrome-extensie vanuit de repository.",
  },
  chart: {
    caption: "Voorbeeldvlucht KL1695, Amsterdam naar Barcelona op 14 juni, Economy Light. De prijs was € 170 toen het plafond werd gekocht; de reiziger boekte voor € 255 toen de airline € 260 vroeg.",
    cardMeta: "14 juni 2027, Economy Light",
    exampleChip: "Voorbeeld",
    yourCap: "Jouw plafond",
    price: "Prijs bij de airline",
    youGetBack: "Je krijgt terug",
    premium: "Premie",
    deductible: "Eigen risico",
    maxPayout: "Maximale uitbetaling",
    activeAfter: "Gaat in na",
    hours: (h: number) => (h === 1 ? "1 uur" : `${h} uur`),
    dragHint: "Sleep de plafondlijn, of selecteer hem en gebruik de pijltjestoetsen.",
    liveParams: (net: string) => `Premie volgens de openbare formule met actuele contractparameters (${net}).`,
    exampleParams: "Voorbeeldparameters: actuele contractgegevens konden niet worden geladen.",
    sliderLabel: "Hoogte van het plafond",
    daysBefore: "dagen voor boeken",
    booked: "geboekt",
    alt: (cap: number, payout: number, premium: number) =>
      `Grafiek van een voorbeeldvlucht. De prijs stijgt in twee weken van € 170 naar € 260. Met een plafond van ${eur(cap)} en een boeking voor € 255 is de uitbetaling ${eur(payout)}. De premie voor dit plafond is ${eur(premium)}.`,
  },
  how: {
    title: "Zo werkt het",
    features: [
      {
        body: "Terwijl je zoekt, herkent de CapFare-extensie de vlucht op de pagina en laat zien wat het kost om een maximumprijs vast te zetten voor precies die vlucht, datum en tariefklasse. De premie komt uit de openbare formule op de blockchain; de prijs op de pagina is alleen een hint.",
        points: (d: number): string[] => [
          "Je ziet het plafond, de premie, het eigen risico (€ " + (d / 100).toFixed(0) + ") en de maximale uitbetaling voordat je betaalt.",
          "Het plafond geldt 7 dagen en gaat in na een korte wachttijd.",
          "Geen extensie? Met Check een vlucht op deze website doe je hetzelfde op je telefoon.",
        ],
      },
      {
        body: "Boek de vlucht waar je wilt: op de site van de airline, bij een reisbureau of via een vergelijkingssite. Net geboekt? De extensie biedt een dalingsgarantie aan: wordt dezelfde vlucht binnen 7 dagen goedkoper, dan krijg je het verschil.",
        points: (_d: number): string[] => [
          "De dekking hoort bij de vlucht, niet bij de website.",
          "Je boeking zelf blijft tussen jou en de airline.",
        ],
      },
      {
        body: "Upload je bevestigingsmail, of open je boekingspagina met de CapFare-extensie en druk op Controleer met CapFare. De boeking wordt gecontroleerd in een beveiligde enclave en alleen de vlucht, tariefklasse en prijs komen terug. Bij niet-restitueerbare tickets gaat de uitbetaling direct uit de kluis.",
        points: (d: number): string[] => [
          "Voorbeeld: prijs bij de airline € 260, jij betaalde € 255, plafond € 180, eigen risico € " + (d / 100).toFixed(0) + ": je krijgt € " + ((25500 - 18000 - d) / 100).toFixed(0) + ".",
          "Restitueerbare tickets hebben voor vertrek nog één live controle van de boeking nodig, omdat een e-mail geen annulering laat zien.",
        ],
      },
    ],
    steps: [
      { n: "1", title: "Zet een maximumprijs vast", body: "Kies de vlucht, datum en tariefklasse, stel je maximumprijs in en betaal een kleine premie. Het plafond geldt 7 dagen." },
      { n: "2", title: "Boek waar je wilt", body: "Boek die vlucht op de site van de airline of bij een reisbureau, wanneer het jou uitkomt." },
      { n: "3", title: "Krijg het verschil", body: "Upload je boekingsbevestiging. Lag de prijs van de airline boven je plafond, dan krijg je het verschil uitbetaald." },
    ],
    shotAlt: [
      "Schermafbeelding: de CapFare-extensie op een zoekpagina voor vluchten, met het aanbod om een maximumprijs vast te zetten.",
      "Schermafbeelding: de boekingsbevestiging met de CapFare-extensie die de geboekte prijs toont.",
      "Schermafbeelding: de boekingspagina van de demo-boekingssite met de CapFare-extensie die Controleer met CapFare aanbiedt.",
    ],
    stubLabels: ["Maximumprijs", "Geboekt", "Uitbetaald"],
  },
  products: {
    title: "Twee soorten bescherming",
    cap: {
      name: "Prijsplafond",
      when: "Voordat je boekt",
      body: "Voor als je nog niet klaar bent om te boeken. Zet tot 7 dagen een maximumprijs vast.",
      example: (d: number, m: number) =>
        `Voorbeeld: de prijs is vandaag € 170 en je zet € 180 vast. De prijs loopt op naar € 260 en je boekt voor € 255. Je krijgt € 255 − € 180 − ${eur(d)} eigen risico = ${eur(Math.min(25500 - 18000 - d, m))}. Een plafond keert maximaal ${eur(m)} uit.`,
    },
    drop: {
      name: "Dalingsgarantie",
      when: "Direct nadat je boekt",
      body: "Voor als je net hebt geboekt. Daalt de prijs van dezelfde vlucht binnen 7 dagen, dan krijg je het verschil.",
      example: (d: number, m: number) =>
        `Voorbeeld: je boekte voor € 220. In de 7 dagen daarna zakt de prijs van de airline voor dezelfde vlucht naar € 195. Je krijgt € 220 − € 195 − ${eur(d)} eigen risico = ${eur(Math.max(0, Math.min(22000 - 19500 - d, m)))}. Een dalingsgarantie keert maximaal ${eur(m)} uit.`,
    },
    paramsNote: (live: boolean) => (live ? "Eigen risico en maximum zijn de huidige contractparameters." : "Eigen risico en maximum zijn voorbeeldparameters."),
  },
  anywhere: {
    title: "Boek waar je wilt",
    body: [
      "De dekking hoort bij de vlucht, niet bij de website. Wat telt zijn het vluchtnummer, de datum, de luchthavens en de tariefklasse op je boekingsbevestiging. Je kunt dus boeken bij de airline, een reisbureau of een vergelijkingssite.",
      "De Chrome-extensie laat tijdens het zoeken een offerte zien. Nu werkt hij op Skyline Travel, de demo-boekingssite van CapFare; ondersteuning voor sites van airlines en reisbureaus volgt. Op je telefoon gebruik je Check een vlucht op deze website.",
    ],
  },
  payout: {
    title: "Je uitbetaling bestaat al",
    body: "Voordat je betaalt, wordt de maximale uitbetaling van je polis vastgezet in een kluis. Iedereen kan deze cijfers op de blockchain controleren.",
    rows: { assets: "Geld in de kluizen", locked: "Vastgezet voor lopende polissen", active: "Lopende polissen", solvency: "Solvabiliteitscheck" },
    solvencyDetail: "geld in de kluizen ≥ vastgezet + aangevraagde opnames",
    passed: "Geslaagd",
    failed: "Mislukt",
    loading: "Actuele cijfers laden…",
    error: (t: string | null) => (t ? `We konden de actuele kluisgegevens niet laden. Laatst bijgewerkt om ${t}.` : "We konden de actuele kluisgegevens niet laden. Probeer het over een minuut opnieuw."),
    stale: (t: string) => `De actuele gegevens lopen achter. Laatst bijgewerkt om ${t}.`,
    updated: (t: string) => `Bijgewerkt om ${t}`,
    link: "Bekijk alle cijfers op de transparantiepagina",
    sumNote: "Beide kluizen, in test-USDC.",
  },
  privacy: {
    title: "Wij zien nooit wie je bent",
    body: [
      "Je uploadt je boekingsbevestiging of typt je boekingscode. Die wordt op je eigen apparaat versleuteld en alleen geopend in een beveiligde enclave: een afgeschermd deel van een processor waar zelfs de beheerder van de server niet in kan kijken.",
      "De enclave geeft vier dingen door: de vlucht, de datum, de tariefklasse en de prijs. Je naam, e-mailadres en boekingscode komen nooit bij de servers van CapFare of op de blockchain.",
    ],
    note: "In dit testnet-prototype draaien de diensten met ontwikkelsleutels, nog niet in een hardware-enclave. De transparantiepagina laat zien welke sleutels zijn geregistreerd.",
  },
  fine: {
    title: "De kleine lettertjes, in gewone taal",
    items: [
      "De dekking geldt voor één exacte vlucht, datum, tariefklasse en route. Een andere vlucht of tariefklasse valt er niet onder.",
      (h: number) => `Een prijsplafond gaat ${h === 1 ? "1 uur" : `${h} uur`} na aankoop in. Boekingen van daarvoor tellen niet mee.`,
      "Van elke uitbetaling gaat een eigen risico af, en elke polis heeft een maximale uitbetaling. Je ziet beide voordat je betaalt.",
      (refund: boolean) =>
        refund
          ? "We beloven niet dat er plaatsen beschikbaar blijven. Raakt je tariefklasse uitverkocht terwijl je plafond loopt en ongebruikt is, dan krijg je je premie terug."
          : "We beloven niet dat er plaatsen beschikbaar blijven. Raakt je tariefklasse uitverkocht, dan kun je het plafond niet gebruiken.",
      "Niet-restitueerbare tickets worden uitbetaald zodra de claim is gecontroleerd. Restitueerbare tickets worden uitbetaald na nog één live controle van de boeking, vanaf een dag voor vertrek: open je boekingspagina met de CapFare-extensie, of plak de link. Een e-mail alleen kan niet laten zien dat je niet hebt geannuleerd.",
      "Alleen boekingen voor de hoofdreiziger die je bij aankoop opgaf, tellen voor een claim.",
    ],
  },
  lp: {
    title: "Voor liquiditeitsverschaffers",
    body: "Liquiditeitsverschaffers vullen de kluizen en verdienen de premies; uitbetalingen komen uit de kluizen. Stortingen en opnames worden eens per periode verwerkt tegen een gepubliceerde aandeelprijs, en de maximale uitbetaling van elke polis blijft vastgezet tot die afloopt.",
    risk: "Je kunt geld verliezen: als veel reizigers worden uitbetaald, krimpt de kluis.",
    link: "Open het LP-dashboard",
  },
  faq: {
    title: "Vragen",
    items: [
      { q: "Wat gebeurt er als ik niet boek?", a: "Dan gebeurt er verder niets. Het plafond verloopt na 7 dagen en de premie krijg je niet terug, behalve als je tariefklasse uitverkocht raakte terwijl het plafond liep." },
      { q: "Wat als de vlucht uitverkocht raakt?", a: "Beschikbaarheid dekken we niet. Ziet het orakel dat je tariefklasse uitverkocht is terwijl je plafond loopt en ongebruikt is, dan gaat de premie terug naar je tegoed." },
      { q: "Wat als ik mijn boeking annuleer?", a: "Dan is er geen uitbetaling. Bij restitueerbare tickets controleren we een dag voor vertrek of de boeking nog bestaat voordat we uitbetalen." },
      { q: "Welke airlines werken?", a: "De dekking werkt voor elke boeking waarvan we de bevestiging kunnen controleren. In dit prototype zijn dat bevestigingen in KLM-formaat (getest met synthetische voorbeelden). Meer airlines volgen." },
      { q: "Waarom is er een eigen risico en een wachttijd?", a: "Die houden de premies laag. Zonder die regels zouden mensen die al weten dat een prijs gaat stijgen vlak voor het boeken bescherming kopen, en betaalt de rest daarvoor." },
      { q: "Hoe krijg ik mijn geld?", a: "Standaard op je CapFare-saldo in USDC. Daarvandaan kun je via een betaalpartner met vergunning opnemen naar je bankrekening (IBAN), of een andere digitale munt ontvangen. Op testnet is dat gesimuleerd." },
      { q: "Hoe controleren jullie mijn boeking?", a: "Op twee manieren. Upload de originele bevestigingsmail: de digitale handtekening laat zien dat die van de airline of reissite komt en niet is aangepast. Of open je boekingspagina met de CapFare-extensie en druk op Controleer met CapFare: onze controle laadt die pagina rechtstreeks van de boekingssite en ziet de boeking zoals hij nu is, ook een annulering. In beide gevallen komen alleen de vlucht, het tarief, de prijs en een onleesbare vingerafdruk van de naam van de hoofdreiziger terug, zodat alleen jouw eigen boeking telt." },
      { q: "Is dit een verzekering?", a: "Nee. Het is een testnet-prototype van prijsbescherming. Voor een commerciële lancering is een verzekeraar of andere partner met de juiste vergunning nodig." },
      { q: "Heb ik crypto nodig?", a: "Nee. Je logt in met een passkey, betaalt met vooraf opgewaardeerd tegoed en betaalt nooit netwerkkosten. Op testnet werkt alles met testgeld." },
    ],
  },
  footer: {
    testnet: "Testnet-prototype. Er wordt geen echt geld gebruikt.",
    notInsurance: "CapFare is prijsbescherming, geen verzekering. Voor een commerciële lancering is een partner met vergunning nodig.",
    links: { github: "GitHub", docs: "Documentatie", transparency: "Transparantie", x: "X", legal: "Juridisch", lp: "LP-dashboard" },
  },
  app: {
    network: (n: string) => `Netwerk: ${n === "Local sandbox" ? "lokale sandbox" : n}`,
  },
};
