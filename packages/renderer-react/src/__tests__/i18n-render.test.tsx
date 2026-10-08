import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackageApp } from '../../app/App';
import { ContentRenderer } from '../../app/components/ContentRenderer';
import { PathView } from '../../app/components/PathView';
import { QuestionnaireView } from '../../app/components/QuestionnaireView';
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireSkip,
  QuestionnaireSubmit,
} from '../../app/components/ui/questionnaire';
import type { ContentPackage, PageNode, PathNode } from '../../app/types';
import { I18nProvider } from '../../app/lib/use-i18n';
import { questionnaireNode } from './fixtures';

function render(lang: string | undefined, ui: ReactNode): string {
  return renderToStaticMarkup(<I18nProvider lang={lang}>{ui}</I18nProvider>);
}

const videoNode = {
  type: 'video' as const,
  src: './lesson.mp4',
  captions: './lesson.vtt',
};

const pathNode: PathNode = {
  type: 'path',
  pageIds: ['page:a.mdx', 'page:b.mdx', 'page:c.mdx'],
};

const pathPages: PageNode[] = [
  {
    type: 'page',
    id: 'page:a.mdx',
    source: 'a.mdx',
    metadata: { title: 'First authored' },
    content: [],
  },
  {
    type: 'page',
    id: 'page:b.mdx',
    source: 'b.mdx',
    metadata: { title: 'Second authored', description: 'Descrição autoral' },
    content: [],
  },
  {
    type: 'page',
    id: 'page:c.mdx',
    source: 'c.mdx',
    metadata: { title: 'Third authored' },
    content: [],
  },
];

function pathView(): string {
  return render(
    'pt-BR',
    <PathView
      node={pathNode}
      pathPages={pathPages}
      pageStates={{ 'page:a.mdx': { visited: true } }}
      onNavigatePathPage={() => {}}
    />,
  );
}

function emptyPackage(lang?: string): ContentPackage {
  return {
    metadata:
      lang === undefined ? { title: 'Empty' } : { title: 'Empty', lang },
    presentation: { type: 'scroll', pages: [] },
  };
}

function authoredPackage(lang: string): ContentPackage {
  return {
    metadata: { title: 'Pacote', lang },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: 'page:intro.mdx',
          source: 'intro.mdx',
          metadata: { title: 'Introdução' },
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'Texto autoral' }],
            },
          ],
        },
      ],
    },
  };
}

describe('player i18n: English', () => {
  it('renders the generated video and caption labels', () => {
    const html = render(undefined, <ContentRenderer nodes={[videoNode]} />);
    expect(html).toContain('aria-label="Video"');
    expect(html).toContain('label="Captions"');
  });

  it('renders the questionnaire wizard labels', () => {
    const html = render(
      undefined,
      <QuestionnaireView node={questionnaireNode} />,
    );
    expect(html).toContain('Previous question');
    expect(html).toContain('Next question');
    expect(html).toContain('Submit questionnaire');
  });

  it('renders the questionnaire progress counter with progressbar semantics', () => {
    const html = render(
      undefined,
      <QuestionnaireView node={questionnaireNode} />,
    );
    expect(html).toContain('role="progressbar"');
    // English keeps the primitive's default accessible name unchanged.
    expect(html).toContain('aria-label="Questionnaire progress"');
    // The numeric range is preserved alongside the announced value.
    expect(html).toContain('aria-valuemin="1"');
    expect(html).toContain('aria-valuemax="2"');
    expect(html).toContain('aria-valuenow="1"');
    // The announced value is localized rather than the primitive's English.
    expect(html).toContain('aria-valuetext="Question 1 of 2"');
    // The visible counter shows the same localized label.
    expect(html).toContain('>Question 1 of 2</div>');
  });

  it('renders the shadcn questionnaire default actions', () => {
    const html = render(undefined, <QuestionnaireDefaults />);
    expect(html).toContain('Previous');
    expect(html).toContain('Skip');
    expect(html).toContain('Next');
    expect(html).toContain('Submit');
  });

  it('renders the empty package message', () => {
    const html = renderToStaticMarkup(
      <PackageApp contentPackage={emptyPackage()} />,
    );
    expect(html).toContain('This package does not contain any content.');
  });
});

describe('player i18n: Brazilian Portuguese', () => {
  it('renders the generated video and caption labels', () => {
    const html = render('pt-BR', <ContentRenderer nodes={[videoNode]} />);
    expect(html).toContain('aria-label="Vídeo"');
    expect(html).toContain('label="Legendas"');
  });

  it('renders the questionnaire wizard labels', () => {
    const html = render(
      'pt-BR',
      <QuestionnaireView node={questionnaireNode} />,
    );
    expect(html).toContain('Pergunta anterior');
    expect(html).toContain('Próxima pergunta');
    expect(html).toContain('Enviar questionário');
  });

  it('renders the questionnaire progress counter with progressbar semantics', () => {
    const html = render(
      'pt-BR',
      <QuestionnaireView node={questionnaireNode} />,
    );
    expect(html).toContain('role="progressbar"');
    // The accessible name is localized rather than the primitive's English.
    expect(html).toContain('aria-label="Progresso do questionário"');
    // The numeric range is preserved alongside the announced value.
    expect(html).toContain('aria-valuemin="1"');
    expect(html).toContain('aria-valuemax="2"');
    expect(html).toContain('aria-valuenow="1"');
    expect(html).toContain('aria-valuetext="Pergunta 1 de 2"');
    expect(html).toContain('>Pergunta 1 de 2</div>');
    // The authored prompt is never translated.
    expect(html).toContain('Which option is correct?');
  });

  it('renders the shadcn questionnaire default actions', () => {
    const html = render('pt-BR', <QuestionnaireDefaults />);
    expect(html).toContain('Anterior');
    expect(html).toContain('Pular');
    expect(html).toContain('Próxima');
    expect(html).toContain('Enviar');
  });

  it('renders the Path navigation label and statuses', () => {
    const html = pathView();
    expect(html).toContain('aria-label="Trilha"');
    expect(html).toContain('Visitada');
    expect(html).toContain('Disponível');
    expect(html).toContain('Bloqueada');
    // Authored descriptions are passed through untouched.
    expect(html).toContain('Descrição autoral');
  });

  it('renders the empty package message', () => {
    const html = renderToStaticMarkup(
      <PackageApp contentPackage={emptyPackage('pt-BR')} />,
    );
    expect(html).toContain('Este pacote não contém nenhum conteúdo.');
  });
});

describe('player i18n: unsupported languages fall back to English', () => {
  it('renders English chrome for a language with no dictionary', () => {
    const html = render('fr', <ContentRenderer nodes={[videoNode]} />);
    expect(html).toContain('aria-label="Video"');
    expect(html).toContain('label="Captions"');
    expect(html).not.toContain('Vídeo');
  });

  it('renders the English empty package message', () => {
    const html = renderToStaticMarkup(
      <PackageApp contentPackage={emptyPackage('fr')} />,
    );
    expect(html).toContain('This package does not contain any content.');
    expect(html).not.toContain('Este pacote');
  });
});

describe('player i18n: authored content is never translated', () => {
  it('keeps authored titles, descriptions and body text verbatim', () => {
    const html = renderToStaticMarkup(
      <PackageApp contentPackage={authoredPackage('pt-BR')} />,
    );
    expect(html).toContain('Introdução');
    expect(html).toContain('Texto autoral');
  });

  it('keeps authored Path titles while localizing the status chrome', () => {
    const html = pathView();
    expect(html).toContain('First authored');
    expect(html).toContain('Second authored');
    expect(html).toContain('Third authored');
    // The chrome is localized while the authored titles stay untouched.
    expect(html).toContain('Visitada');
    expect(html).not.toContain('Locked');
    expect(html).not.toContain('Available');
  });
});

function QuestionnaireDefaults() {
  return (
    <Questionnaire
      items={[{ name: 'q1', required: true, choices: [{ value: 'a' }] }]}
    >
      <QuestionnaireItem name='q1' multiple={false} required>
        <QuestionnaireChoices>
          <QuestionnaireChoice value='a'>Option A</QuestionnaireChoice>
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnairePrevious />
      <QuestionnaireSkip />
      <QuestionnaireNext />
      <QuestionnaireSubmit />
    </Questionnaire>
  );
}
