import { Coder, CODER_REGISTRY, Context } from "../src/apache_beam/coders/coders";
import { Writer, Reader } from 'protobufjs';

import assertions = require('assert');
import yaml = require('js-yaml');
import fs = require('fs');
import util = require('util');

const STANDARD_CODERS_FILE = '../../model/fn-execution/src/main/resources/org/apache/beam/model/fnexecution/v1/standard_coders.yaml';

const UNSUPPORTED_EXAMPLES = {
    "beam:coder:iterable:v1-2": "",
    "beam:coder:iterable:v1-3": "",
}

// TODO(pabloem): Empty this list.
const UNSUPPORTED_CODERS = [
    "beam:coder:interval_window:v1",
    "beam:coder:double:v1",
    "beam:coder:timer:v1",
    "beam:coder:global_window:v1",
    "beam:coder:windowed_value:v1",
    "beam:coder:param_windowed_value:v1",
    "beam:coder:row:v1",
    "beam:coder:sharded_key:v1",
    "beam:coder:custom_window:v1",
    "beam:coder:iterable:v1",
];

const _urn_to_json_value_parser = {
    'beam:coder:bytes:v1': _ => x => new TextEncoder().encode(x),
    'beam:coder:bool:v1': _ => x => x,
    'beam:coder:string_utf8:v1': _ => x => x as string,
    'beam:coder:varint:v1': _ => x => x,
    'beam:coder:double:v1': _ => x => new Number(x),
    'beam:coder:kv:v1': components => x => ({ 'key': components[0](x['key']), 'value': components[1](x['value']) }),
    'beam:coder:iterable:v1': components => x => (x.map(elm => components[0](elm))),
    // 'beam:coder:double:v1': parse_float,
}

interface CoderRepr {
    urn: string,
    payload?: Uint8Array,
    components?: Array<CoderRepr>
}

type CoderSpec = {
    coder: CoderRepr,
    nested?: boolean,
    examples: object
}

function get_json_value_parser(coderRepr: CoderRepr) {
    // TODO(pabloem): support 'beam:coder:row:v1' coder.
    console.log(util.inspect(coderRepr, { colors: true }));

    var value_parser_factory = _urn_to_json_value_parser[coderRepr.urn]

    if (value_parser_factory === undefined) {
        throw new Error(util.format("Do not know how to parse example values for %s", coderRepr))
    }

    const components = coderRepr.components || []
    const componentParsers = components.map(componentRepr => get_json_value_parser(componentRepr))
    return value_parser_factory(componentParsers)
}

describe("standard Beam coders on Javascript", function() {
    const docs: Array<CoderSpec> = yaml.loadAll(fs.readFileSync(STANDARD_CODERS_FILE, 'utf8'));
    docs.forEach(doc => {
        const urn = doc.coder.urn;
        if (UNSUPPORTED_CODERS.includes(urn)) {
            return;
        }

        // The YAML is designed so doc.nested is three-valued, and undefined means "test both variations"
        var contexts: Context[] = []
        if (doc.nested !== true) {
            contexts.push(Context.wholeStream)
        }
        if (doc.nested !== false) {
            contexts.push(Context.needsDelimiters)
        }

        contexts.forEach(context => {
            describe("in Context " + context, function() {
                const spec = doc;

                const coderConstructor = CODER_REGISTRY.get(urn);
                var coder;
                if (spec.coder.components) {
                    var components;
                    try {
                        components = spec.coder.components.map(c => new (CODER_REGISTRY.get(c.urn))())
                    } catch (Error) {
                        return;
                    }
                    coder = new coderConstructor(...components);
                } else {
                    coder = new coderConstructor();
                }
                describeCoder(coder, urn, context, spec);
            });
        })
    });
});

function describeCoder<T>(coder: Coder<T>, urn, context, spec: CoderSpec) {
    describe(util.format("coder %s", util.inspect(coder, { colors: true, breakLength: Infinity })), function() {
        let examples = 0;
        const parser = get_json_value_parser(spec.coder);
        for (let expected in spec.examples) {
            examples += 1;
            if ((urn + '-' + examples) in UNSUPPORTED_EXAMPLES) {
                continue;
            }
            var value = parser(spec.examples[expected]);
            const expectedEncoded = Buffer.from(expected, 'binary')
            coderCase(coder, value, expectedEncoded, context, examples);
        }
    });
}

function coderCase<T>(coder: Coder<T>, obj, expectedEncoded: Uint8Array, context, exampleCount) {
    it(util.format("encodes example %d correctly", exampleCount), function() {
        var writer = new Writer();
        coder.encode(obj, writer, context);
        assertions.deepEqual(writer.finish(), expectedEncoded);
    });

    it(util.format("decodes example %d correctly", exampleCount), function() {
        const decoded = coder.decode(new Reader(expectedEncoded), context);
        assertions.deepEqual(decoded, obj);
    });
}