export interface LanguagePage {
  slug: string;
  /** ISO 639-3, as the pipeline uses. */
  lang: string;
  /** BCP 47, for the html lang attribute and hreflang. */
  htmlLang: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
  placeholder: string;
  sample: string;
}

/** Native-speaker review pending for everything except English. */
export const LANGUAGE_PAGES: LanguagePage[] = [
  {
    slug: 'de',
    lang: 'deu',
    htmlLang: 'de',
    title: 'KI-Texte natürlicher klingen lassen · Plainhand',
    description:
      'Plainhand markiert typische KI-Floskeln in deutschen Texten und schreibt steife Sätze um. Kostenlos, im Browser, ohne Upload.',
    heading: 'KI-Texte, die nach dir klingen',
    intro:
      'Füge einen Entwurf ein. Plainhand markiert Floskeln wie „spielt eine entscheidende Rolle“ und schreibt steife Sätze um, auf deinem Gerät oder mit deinem eigenen API-Schlüssel.',
    placeholder: 'Füge deinen Entwurf ein.',
    sample: `## Unser neues Onboarding

In der heutigen schnelllebigen Welt spielt ein gutes Onboarding eine entscheidende Rolle. Es ist wichtig zu beachten, dass 64 % der neuen Nutzer in der ersten Woche abspringen. Darüber hinaus wollen wir ein nahtloses Erlebnis schaffen.

Ich hoffe, das hilft!`,
  },
  {
    slug: 'es',
    lang: 'spa',
    htmlLang: 'es',
    title: 'Haz que un texto de IA suene natural · Plainhand',
    description:
      'Plainhand marca las muletillas típicas de la IA en textos en español y reescribe las frases rígidas. Gratis, en tu navegador, sin subir nada.',
    heading: 'Textos de IA que suenan a ti',
    intro:
      'Pega un borrador. Plainhand marca frases hechas como «juega un papel crucial» y reescribe las frases rígidas, en tu dispositivo o con tu propia clave de API.',
    placeholder: 'Pega tu borrador.',
    sample: `## Nuestro nuevo proceso de bienvenida

En el mundo actual, la bienvenida a nuevos clientes juega un papel crucial. Cabe destacar que el 64 % de los usuarios abandona en la primera semana. Además, queremos ofrecer una experiencia sin fisuras.

¡Espero que esto te ayude!`,
  },
  {
    slug: 'fr',
    lang: 'fra',
    htmlLang: 'fr',
    title: 'Rendre un texte d’IA plus naturel · Plainhand',
    description:
      'Plainhand repère les tics d’écriture de l’IA dans vos textes en français et réécrit les phrases figées. Gratuit, dans votre navigateur, sans envoi.',
    heading: 'Des textes d’IA qui sonnent comme vous',
    intro:
      'Collez un brouillon. Plainhand repère les formules toutes faites comme « joue un rôle crucial » et réécrit les phrases figées, sur votre appareil ou avec votre propre clé d’API.',
    placeholder: 'Collez votre brouillon.',
    sample: `## Notre nouvel accueil

Dans le monde d'aujourd'hui, l'accueil des nouveaux clients joue un rôle crucial. Il est important de noter que 64 % des utilisateurs partent dès la première semaine. De plus, nous voulons une expérience sans faille.

J'espère que cela vous aide !`,
  },
  {
    slug: 'pt',
    lang: 'por',
    htmlLang: 'pt',
    title: 'Deixe um texto de IA mais natural · Plainhand',
    description:
      'O Plainhand marca os vícios de escrita da IA em textos em português e reescreve as frases rígidas. Grátis, no navegador, sem envio.',
    heading: 'Textos de IA com a sua voz',
    intro:
      'Cole um rascunho. O Plainhand marca frases feitas como “desempenha um papel crucial” e reescreve as frases rígidas, no seu dispositivo ou com a sua própria chave de API.',
    placeholder: 'Cole o seu rascunho.',
    sample: `## Nosso novo onboarding

No mundo atual, um bom onboarding desempenha um papel crucial. Vale ressaltar que 64% dos usuários desistem na primeira semana. Além disso, queremos criar uma experiência fluida.

Espero que isso ajude!`,
  },
];

export interface PageConfig {
  lang: string;
  htmlLang: string;
  heading: string;
  intro: string;
  placeholder: string;
  sample: string;
}
