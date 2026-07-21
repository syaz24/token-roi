import { describe, expect, it } from 'vitest';
import {
  isWithin,
  matchProject,
  normPath,
  normaliseRemote,
  type MappingRule,
  type ProjectRef,
} from '@/lib/projects/match';

const parent: ProjectRef = { id: 'p-parent', pathNorm: 'c:/users/dev/code' };
const nested: ProjectRef = {
  id: 'p-nested',
  pathNorm: 'c:/users/dev/code/demo-project',
  remoteUrl: 'https://github.com/acme/demo-project.git',
};
const remoteOnly: ProjectRef = {
  id: 'p-remote',
  pathNorm: 'd:/elsewhere/mirror',
  remoteUrl: 'git@github.com:acme/widgets.git',
};
const PROJECTS = [parent, nested, remoteOnly];

describe('normPath', () => {
  it('normalises separators, trailing slashes, drive case and casing', () => {
    expect(normPath('C:\\Users\\Dev\\Code\\')).toBe('c:/users/dev/code');
    expect(normPath('  C:/Users/Dev/Code  ')).toBe('c:/users/dev/code');
    expect(normPath('C:\\Users/Dev\\Code')).toBe('c:/users/dev/code');
    expect(normPath('/home/u/proj//')).toBe('/home/u/proj');
  });
});

describe('isWithin', () => {
  it('is true for identity and true children only', () => {
    expect(isWithin('c:/a/b', 'c:/a/b')).toBe(true);
    expect(isWithin('c:/a/b', 'c:/a/b/c')).toBe(true);
    expect(isWithin('c:/a/b', 'c:/a/bc')).toBe(false); // not a sibling-prefix match
    expect(isWithin('c:/a/b', 'c:/a')).toBe(false);
  });
});

describe('normaliseRemote', () => {
  it('canonicalises scp-style and https git remotes', () => {
    expect(normaliseRemote('git@github.com:acme/widgets.git')).toBe('https://github.com/acme/widgets');
    expect(normaliseRemote('https://GitHub.com/acme/widgets.git/')).toBe('https://github.com/acme/widgets');
    expect(normaliseRemote('https://github.com/acme/widgets')).toBe('https://github.com/acme/widgets');
  });

  it('matches the same repository written in any of those forms', () => {
    const forms = [
      'git@github.com:acme/widgets.git',
      'https://github.com/acme/widgets.git',
      'https://github.com/acme/widgets.git/',
      'https://github.com/acme/widgets',
    ];
    const canonical = forms.map(normaliseRemote);
    expect(new Set(canonical).size).toBe(1);
  });
});

describe('matchProject precedence', () => {
  it('1. exact path match wins', () => {
    expect(matchProject({ workingDirectory: 'C:\\Users\\Dev\\Code\\demo-project' }, PROJECTS)).toEqual({
      projectId: 'p-nested',
      method: 'exact',
    });
  });

  it('exact also matches against gitRoot', () => {
    const p: ProjectRef = { id: 'p-git', pathNorm: 'c:/somewhere', gitRoot: 'C:\\Repos\\thing' };
    expect(matchProject({ workingDirectory: 'c:/repos/thing' }, [p])).toEqual({
      projectId: 'p-git',
      method: 'exact',
    });
  });

  it('2. child folders map to the DEEPEST containing root', () => {
    expect(
      matchProject({ workingDirectory: 'C:/Users/Dev/Code/demo-project/packages/api' }, PROJECTS),
    ).toEqual({ projectId: 'p-nested', method: 'child' });
    expect(matchProject({ workingDirectory: 'C:/Users/Dev/Code/other' }, PROJECTS)).toEqual({
      projectId: 'p-parent',
      method: 'child',
    });
  });

  it('deepest-root precedence is independent of project ordering', () => {
    expect(
      matchProject({ workingDirectory: 'c:/users/dev/code/demo-project/src' }, [...PROJECTS].reverse()),
    ).toEqual({ projectId: 'p-nested', method: 'child' });
  });

  it('3. remote url matches when the path does not', () => {
    expect(
      matchProject(
        { workingDirectory: 'z:/unknown/checkout', remoteUrl: 'https://github.com/acme/widgets' },
        PROJECTS,
      ),
    ).toEqual({ projectId: 'p-remote', method: 'remote' });
  });

  it('4. manual mapping rules are the last resort', () => {
    const rules: MappingRule[] = [
      { pattern: 'E:\\Scratch\\demos', kind: 'prefix', projectId: 'p-parent' },
      { pattern: 'E:\\Exact\\one', kind: 'exact', projectId: 'p-nested' },
    ];
    expect(matchProject({ workingDirectory: 'E:/Scratch/demos/x/y' }, PROJECTS, rules)).toEqual({
      projectId: 'p-parent',
      method: 'manual',
    });
    expect(matchProject({ workingDirectory: 'e:/exact/one' }, PROJECTS, rules)).toEqual({
      projectId: 'p-nested',
      method: 'manual',
    });
    expect(matchProject({ workingDirectory: 'e:/exact/one/deeper' }, PROJECTS, rules)).toEqual({
      projectId: null,
      method: null,
    });
  });

  it('5. unassigned when nothing matches', () => {
    expect(matchProject({ workingDirectory: 'q:/nope' }, PROJECTS)).toEqual({
      projectId: null,
      method: null,
    });
    expect(matchProject({ workingDirectory: null }, PROJECTS)).toEqual({
      projectId: null,
      method: null,
    });
  });

  it('is case-insensitive and separator-agnostic on Windows paths', () => {
    const variants = [
      'C:\\Users\\Dev\\Code\\DEMO-PROJECT',
      'c:/users/dev/code/demo-project',
      'C:/Users\\Dev/Code\\demo-project\\',
      '  C:\\USERS\\Dev\\CODE\\Demo-Project  ',
    ];
    for (const v of variants) {
      expect(matchProject({ workingDirectory: v }, PROJECTS).projectId).toBe('p-nested');
    }
  });
});
