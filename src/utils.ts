import * as fs from 'fs';

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function sanitizeJsonString(jsonString: string): string {
  // This will remove all newlines and carriage returns
  // let sanitizedJsonString = jsonString.replace(/(\r\n|\n|\r)/gm, "");

  let sanitizedJsonString = jsonString;

  // // Remove any comments that might be present in the string
  // sanitizedJsonString = sanitizedJsonString.replace(/\/\/.*$/gm, '');

  // // Remove any trailing commas before closing brackets or braces
  // sanitizedJsonString = sanitizedJsonString.replace(/,\s*([}\]])/g, '$1');

  // This will remove ```json blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```json/g, "");

  // This will remove ```typescript blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```typescript/g, "");

  // This will remove ```ts blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```ts/g, "");

  // This will remove ```javascript blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```javascript/g, "");

  // This will remove ```js blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```js/g, "");

  // This will remove ```python blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```python/g, "");

  // This will remove ```py blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```py/g, "");

  // This will remove ```shell blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```shell/g, "");

  // This will remove ```sh blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```sh/g, "");

  // This will remove remaining closing ``` blocks
  sanitizedJsonString = sanitizedJsonString.replace(/```/g, "");

  return sanitizedJsonString;
}

export function extractJson(input: string): { success: boolean; data?: any; error?: string } {
  const sanitizedInput = sanitizeJsonString(input);
  const start = sanitizedInput.indexOf('{');
  const end = sanitizedInput.lastIndexOf('}') + 1;
  const startArray = sanitizedInput.indexOf('[');
  const endArray = sanitizedInput.lastIndexOf(']') + 1;

  let jsonString = "";

  if(start > -1 && end > start){
      jsonString = sanitizedInput.substring(start, end);
  } else if(startArray > -1 && endArray > startArray){
      jsonString = sanitizedInput.substring(startArray, endArray)
  } else {
      return { success: false, error: 'No valid JSON object or array found.' };
  }


  try {
      const json = JSON.parse(jsonString);
      return { success: true, data: json };
  } catch (error: any) {
      return { success: false, error: error.message };
  }
}