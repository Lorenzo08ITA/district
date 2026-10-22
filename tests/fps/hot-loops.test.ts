import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
it('keeps normal-path simulation and packet methods free of object creation', () => {
  const files: Record<string, string[]> = {
    '../../../server/src/fps/GameRoom.ts': [
      'step',
      'shoot',
      'kill',
      'flags',
      'zone',
      'brain',
      'respawn',
      'random',
    ],
    '../../../server/src/fps/History.ts': ['writePose', 'record', 'sample'],
    '../../../client/src/fps/Runtime.ts': ['render'],
    '../../../client/src/fps/Effects.ts': ['update'],
    '../../../client/src/fps/SecondOrderSpring3D.ts': ['update'],
    'arena.ts': ['choose'],
    'math.ts': ['accelerate', 'cast', 'rotate'],
    'bvh.ts': [
      'sweepCapsule',
      'fits',
      'depenetrate',
      'raycast',
      'query',
      'distance',
      'edge',
      'closestPoint',
      'keep',
    ],
    'kinematics.ts': ['step', 'advance', 'slideMove', 'tryStep', 'probe', 'clip', 'startSlide'],
    'weapons.ts': ['trigger', 'update', 'pelletDirection'],
    'protocol.ts': [
      'input',
      'snapshot',
      'hit',
      'finish',
      'reset',
      'push',
      'acknowledge',
      'at',
      'acquire',
      'release',
    ],
  };
  const violations: string[] = [];
  for (const [file, names] of Object.entries(files)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(new URL('../../packages/shared/src/fps/' + file, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function scan(node: ts.Node): void {
      if (ts.isThrowStatement(node)) return;
      if (
        ts.isNewExpression(node) ||
        ts.isObjectLiteralExpression(node) ||
        ts.isArrayLiteralExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node)
      )
        violations.push(
          file + ':' + source.getLineAndCharacterOfPosition(node.getStart(source)).line,
        );
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ['map', 'filter', 'slice', 'subarray', 'from'].includes(node.expression.name.text)
      )
        violations.push(file + ':' + node.expression.name.text);
      ts.forEachChild(node, scan);
    }
    function visit(node: ts.Node): void {
      if (
        (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
        node.name &&
        names.includes(node.name.getText(source)) &&
        node.body
      )
        scan(node.body);
      else if (
        ts.isPropertyDeclaration(node) &&
        node.name &&
        names.includes(node.name.getText(source)) &&
        node.initializer &&
        ts.isArrowFunction(node.initializer)
      )
        scan(node.initializer.body);
      else ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
