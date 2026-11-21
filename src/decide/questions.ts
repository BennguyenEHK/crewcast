import type { Question } from '../backend/systemone.js';
import type { Skill } from '../catalog/skills.js';

export class QuestionBuilder {
  build(skills: Skill[]): Record<string, Question> {
    const questions: Record<string, Question> = {
      task_type: {
        type: 'choice',
        instructions: 'Pick the kind of work the task asks for.',
        criteria: {
          implement: 'build a new feature or behavior',
          fix: 'repair a bug or wrong behavior',
          review: 'check existing code or changes',
          research: 'find out facts or compare options',
          plan: 'design or outline work before doing it',
          docs: 'write or edit documentation',
          test: 'add or change tests',
          refactor: 'change code structure without changing behavior',
          ops: 'run, deploy or maintain systems',
        },
      },
      writes_files: {
        type: 'noul',
        instructions: 'Will finishing the task change or create files?',
        criteria: { true: 'yes, files get changed or created', false: 'no, it only reads or answers' },
      },
      risk_area: {
        type: 'choice',
        instructions: 'Does the task touch a sensitive area? Pick the closest.',
        criteria: {
          none: 'no sensitive area',
          auth: 'logins, sessions, permissions',
          db_schema: 'database tables or migrations',
          payments: 'money, billing, prices',
          deploy: 'release or production setup',
          secrets: 'keys, tokens, passwords',
        },
      },
      size: {
        type: 'choice',
        instructions: 'How many files will the task likely change?',
        criteria: {
          one_file: 'changes or reads one file',
          few_files: '2 to 5 files in one area',
          many_files: 'many files or several modules',
        },
      },
      needs_web: {
        type: 'noul',
        instructions: 'Does the task need fresh information from the web?',
        criteria: { true: 'yes, current or outside facts are needed', false: 'no, the repo and general knowledge are enough' },
      },
    };
    skills.forEach((s, i) => {
      questions[`skill_${i}`] = {
        type: 'noul',
        instructions: `Is the skill "${s.name}" useful for this task? It does: ${s.description}`,
      };
    });
    return questions;
  }
}
