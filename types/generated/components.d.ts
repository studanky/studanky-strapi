import type { Schema, Struct } from '@strapi/strapi';

export interface ConfigFlowRange extends Struct.ComponentSchema {
  collectionName: 'components_config_flow_ranges';
  info: {
    displayName: 'flow-range';
  };
  attributes: {
    max_lps: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    min_lps: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    scale: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 5;
          min: 1;
        },
        number
      >;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'config.flow-range': ConfigFlowRange;
    }
  }
}
