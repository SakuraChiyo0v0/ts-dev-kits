/** CSS Modules 声明:tsdown 把 .module.css 编译为哈希类名映射。 */
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
